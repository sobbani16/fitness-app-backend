// /activity-safety — shared safety evaluation entry points.
// Every recommendation producer routes through services/activitySafety so no
// path can bypass the same policy. All routes are feature-flag gated;
// DRAFT clinical rules never fire for real users (APPROVED-only load).

const express = require('express');
const { getPrisma } = require('../lib/prisma');
const { getUserId } = require('../middleware/rbac');
const uid = req => req.userId || getUserId(req);
const { requireFeature } = require('../middleware/requireFeature');
const safety = require('../services/activitySafety');
const { fetchEnvironment, markStale } = require('../services/environmentService');
const { SYMPTOMS_URGENT, ACTIVITY_CATEGORIES } = require('../services/activitySafety/constants');
const { invalidateSafetyAdvice } = require('../services/activitySafety/recommendationSafety');

const router = express.Router();

const body = req => (req.body && typeof req.body === 'object' ? req.body : {});
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

async function envFor(req) {
  const lat = num(req.query.lat ?? body(req).lat);
  const lon = num(req.query.lon ?? body(req).lon);
  if (lat == null || lon == null) return null; // unknown location → env unknown (never "clear")
  try {
    return markStale(await fetchEnvironment(lat, lon));
  } catch {
    return { available: false }; // provider failure → unknown, not safe
  }
}

async function shadowCheck(req, rec, ctx, env) {
  const prisma = getPrisma();
  // Shadow mode: persist the full per-candidate eval set for offline diffing.
  try {
    if (rec.results) {
      await Promise.all(rec.results.slice(0, 12).map(r => safety.persistEvaluation(prisma, r, ctx, { shadow: true })));
    }
  } catch (err) { req.log?.warn?.({ err }, 'activity-safety shadow persist failed'); }
}

// GET /activity-safety/recommendation?lat=&lon=
// The unified suggestion — per-candidate decisions + chosen suggestion.
router.get('/recommendation', requireFeature('health_aware_recommendations'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const ctx = await safety.loadSafetyContext(prisma, uid(req), {
      preferences: { restRequested: req.query.rest === 'true' },
    });
    const [env, rules] = await Promise.all([envFor(req), safety.loadRules(prisma)]);
    const rec = safety.recommend(ctx, env, { rules });
    shadowCheck(req, rec, ctx, env);
    res.json({
      disposition: rec.disposition,
      policyVersion: rec.policyVersion,
      suggestion: rec.suggestion,
      restFallback: rec.restFallback || null,
      requiredData: rec.requiredData || [],
      urgent: rec.urgent || null,
      activities: (rec.results || []).map(r => ({
        activityId: r.candidateActivityId,
        decision: r.decision,
        suppressed: r.suppressed || false,
        reasons: r.reasons,
        requiredData: r.requiredData,
        alternatives: r.allowedAlternatives,
        betterTime: r.betterTime,
      })),
      environment: env ? { available: env.available !== false, stale: !!env.stale, hazards: undefined } : { available: false },
      noMedicalClaims: true,
    });
  } catch (err) { res.status(500).json({ error: 'evaluation_failed', detail: err.message }); }
});

// POST /activity-safety/evaluate {activityId, lat?, lon?}
// Single-activity check — used by coaching/voice/notification pre-checks
// before any specific activity is suggested.
router.post('/evaluate', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const b = body(req);
    const activity = safety.getActivity(String(b.activityId || ''));
    if (!activity) return res.status(400).json({ error: 'unknown activityId' });
    const [ctx, env, rules] = await Promise.all([
      safety.loadSafetyContext(prisma, uid(req), { preferences: b.preferences || {} }),
      envFor(req), safety.loadRules(prisma),
    ]);
    const r = safety.evaluate(ctx, activity, env, { rules });
    res.json({ ...r, alternatives: undefined, noMedicalClaims: true });
  } catch (err) { res.status(500).json({ error: 'evaluation_failed', detail: err.message }); }
});

// Region-specific emergency numbers — client-declared region only (the app
// knows its locale); geography is never inferred from coordinates.
const EMERGENCY_COPY = {
  us: 'call or text 911', ca: 'call or text 911', gb: 'call 999 or 112',
  eu: 'call 112', in: 'call 112', au: 'call 000', nz: 'call 111',
};
function emergencyCopy(region) {
  const key = /^[a-z]{2}$/i.test(String(region || '')) ? String(region).toLowerCase() : null;
  return EMERGENCY_COPY[key] || 'contact local emergency services';
}

// POST /activity-safety/symptoms {symptoms:[codes], severity?, context?, notes?, region?}
// Capture a self-reported symptom. Urgent codes return escalation guidance —
// deterministic templates, no diagnosis.
router.post('/symptoms', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const b = body(req);
    const codes = (Array.isArray(b.symptoms) ? b.symptoms : []).map(s => String(s).toLowerCase().trim()).filter(Boolean);
    if (!codes.length) return res.status(400).json({ error: 'at least one symptom code is required' });
    const urgent = codes.filter(c => SYMPTOMS_URGENT.has(c));
    const report = await prisma.userSymptomReport.create({
      data: {
        userId: uid(req),
        symptoms: codes,
        severity: ['mild', 'moderate', 'severe'].includes(b.severity) ? b.severity : null,
        context: ['at_rest', 'during_activity', 'after_activity'].includes(b.context) ? b.context : 'unspecified',
        persistence: ['resolving', 'persistent', 'worsening'].includes(b.persistence) ? b.persistence : null,
        source: b.source === 'voice' ? 'voice' : 'manual',
        triageOutcome: urgent.length ? 'urgent_escalation' : 'recorded',
        status: 'active',
      },
    });
    const inv = await invalidateSafetyAdvice(prisma, uid(req), 'symptom_reported').catch(() => null);
    res.status(201).json({
      reportId: report.id,
      disposition: urgent.length ? 'urgent_escalation' : 'recorded',
      message: urgent.length
        ? `Do not begin a workout. Your reported symptoms may require urgent medical attention — ${emergencyCopy(b.region)} or seek urgent care now.`
        : 'Symptom recorded. Activity suggestions will account for it. If symptoms are severe, worsening, or worry you, seek medical advice.',
      suppressesActivitySuggestions: true, // active symptoms always pause suggestions
      urgentSymptoms: urgent,
      invalidated: inv || undefined,
      noDiagnosis: true,
    });
  } catch (err) { res.status(500).json({ error: 'symptom_report_failed', detail: err.message }); }
});

// POST /activity-safety/injuries — self-reported injury; engine sees it on the
// next evaluation automatically (inputsStamp changes → cached evals invalid).
router.post('/injuries', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const b = body(req);
    const bodyPart = String(b.bodyPart || '').toLowerCase().trim();
    if (!bodyPart) return res.status(400).json({ error: 'bodyPart is required' });
    const row = await prisma.userInjury.create({
      data: {
        userId: uid(req),
        type: b.type ? String(b.type).slice(0, 60) : 'unspecified',
        bodyPart,
        laterality: ['left', 'right', 'bilateral', 'na'].includes(b.laterality) ? b.laterality : 'na',
        status: 'current',
        painLevel: num(b.painLevel),
        weightBearingRestriction: b.weightBearingRestriction || null,
        prohibitedCategories: Array.isArray(b.prohibitedCategories) ? b.prohibitedCategories : [],
        source: b.source === 'voice' ? 'voice' : 'self_reported',
        injuredAt: b.injuredAt ? new Date(b.injuredAt) : new Date(),
        rehabInstructions: b.notes ? String(b.notes).slice(0, 1000) : null,
        expectedReassessmentAt: b.expectedReassessmentAt ? new Date(b.expectedReassessmentAt) : null,
      },
    });
    const inv = await invalidateSafetyAdvice(prisma, uid(req), 'injury_reported').catch(() => null);
    res.status(201).json({
      injuryId: row.id,
      message: 'Recorded. Activity suggestions now account for it — this is a self-reported record, not a medical assessment. Follow any clinician guidance you have received.',
      followUps: followUpQuestions(row),
      invalidated: inv || undefined,
      noDiagnosis: true,
    });
  } catch (err) { res.status(500).json({ error: 'injury_report_failed', detail: err.message }); }
});

// Necessary follow-ups only — each answer changes the restriction applied.
function followUpQuestions(injury) {
  const qs = [];
  if (injury.weightBearingRestriction == null) {
    qs.push({ id: 'weight_bearing', ask: 'Did a clinician give you weight-bearing instructions (e.g., non-weight-bearing)?', options: ['non_weight_bearing', 'partial', 'full', 'no_clinician_guidance'] });
  }
  if (injury.expectedReassessmentAt == null) {
    qs.push({ id: 'reassessment', ask: 'Do you have a follow-up or reassessment date?', type: 'date_or_none' });
  }
  if (injury.type === 'unspecified') {
    qs.push({ id: 'type', ask: 'What kind of injury is it, if you know?', options: ['sprain', 'strain', 'fracture', 'pain_unspecified', 'other'] });
  }
  return qs;
}

// POST /activity-safety/feedback — recommendation feedback that can update
// restrictions or trigger reassessment; never auto-permanent.
router.post('/feedback', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const b = body(req);
    const verdict = String(b.verdict || b.type || '').trim();
    const allowed = ['not_comfortable', 'causes_pain', 'have_injury', 'clinician_advised_against', 'want_rest', 'suggest_else', 'inaccurate', 'helpful'];
    if (!allowed.includes(verdict)) return res.status(400).json({ error: `verdict must be one of ${allowed.join(', ')}` });
    const row = await prisma.activitySafetyFeedback.create({
      data: {
        userId: uid(req),
        evaluationId: b.evaluationId || null,
        activityId: b.activityId ? String(b.activityId) : null,
        verdict,
        detail: (b.detail || b.note) ? String(b.detail || b.note).slice(0, 1000) : null,
        resultingAction: 'none',
      },
    });
    const actions = [];
    if (verdict === 'want_rest') {
      actions.push('Suggestions paused for today at your request — rest is a valid choice.');
    }
    if (['clinician_advised_against', 'causes_pain', 'have_injury'].includes(verdict)) {
      actions.push('Tell us the affected body part or clinician restriction and we will apply it to future suggestions. A one-time report is not a permanent ban — you can update it anytime.');
    }
    res.status(201).json({ feedbackId: row.id, actions });
  } catch (err) { res.status(500).json({ error: 'feedback_failed', detail: err.message }); }
});

// GET /activity-safety/profile — correction UX snapshot.
router.get('/profile', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const ctx = await safety.loadSafetyContext(prisma, uid(req));
    res.json({
      profilePresent: ctx.profilePresent,
      conditions: [...ctx.conditions],
      injuries: ctx.injuries.map(i => ({ id: i.id, bodyPart: i.bodyPart, status: i.status, weightBearingRestriction: i.weightBearingRestriction })),
      surgeries: ctx.surgeries.map(s => ({ id: s.id, procedureCategory: s.procedureCategory, status: s.status })),
      restrictions: ctx.restrictions.map(r => ({ id: r.id, categories: r.categories, severity: r.severity, status: r.status, expiresAt: r.expiresAt })),
      activeSymptoms: ctx.symptomReports.map(s => ({ id: s.id, symptoms: s.symptoms, reportedAt: s.reportedAt })),
      mobility: ctx.mobility,
      pregnancyStatus: ctx.pregnancyStatus,
    });
  } catch (err) { res.status(500).json({ error: 'profile_load_failed', detail: err.message }); }
});

// DELETE endpoints — retention hygiene (P-1). User-scoped only; self-reported
// rows hard-delete. Clinician-documented restrictions soft-delete to
// 'superseded' so the restriction audit trail survives user removal.
router.delete('/injuries/:id', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const row = await prisma.userInjury.deleteMany({ where: { id: req.params.id, userId: uid(req) } });
    if (!row.count) return res.status(404).json({ error: 'not_found' });
    await invalidateSafetyAdvice(prisma, uid(req), 'injury_deleted').catch(() => null);
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'injury_delete_failed', detail: err.message }); }
});

// GET /activity-safety/symptoms — list the caller's own symptom reports
// (mobile symptom history). Owner-scoped; newest first; capped.
router.get('/symptoms', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const rows = await prisma.userSymptomReport.findMany({
      where: { userId: uid(req) },
      orderBy: { reportedAt: 'desc' },
      take: Math.min(Number(req.query.limit) || 90, 200),
      select: { id: true, symptoms: true, severity: true, context: true, persistence: true, status: true, source: true, reportedAt: true },
    });
    res.json({ reports: rows });
  } catch (err) { res.status(500).json({ error: 'symptom_list_failed', detail: err.message }); }
});

router.delete('/symptoms/:id', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const row = await prisma.userSymptomReport.deleteMany({ where: { id: req.params.id, userId: uid(req) } });
    if (!row.count) return res.status(404).json({ error: 'not_found' });
    await invalidateSafetyAdvice(prisma, uid(req), 'symptom_deleted').catch(() => null);
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'symptom_delete_failed', detail: err.message }); }
});

// PATCH /activity-safety/symptoms/:id — owner-scoped correction of an existing
// report (severity, context, persistence, notes, or symptom codes). Immutable:
// reportedAt + userId. Edits re-trigger safety-advice invalidation.
router.patch('/symptoms/:id', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const b = body(req);
    const data = {};
    if (b.symptoms !== undefined) {
      const codes = (Array.isArray(b.symptoms) ? b.symptoms : []).map(s => String(s).toLowerCase().trim()).filter(Boolean);
      if (!codes.length) return res.status(400).json({ error: 'symptoms must be a non-empty code list when provided' });
      data.symptoms = codes;
    }
    if (b.severity !== undefined) data.severity = ['mild', 'moderate', 'severe'].includes(b.severity) ? b.severity : null;
    if (b.context !== undefined) data.context = ['at_rest', 'during_activity', 'after_activity', 'unspecified'].includes(b.context) ? b.context : 'unspecified';
    if (b.persistence !== undefined) data.persistence = ['resolving', 'persistent', 'worsening'].includes(b.persistence) ? b.persistence : null;
    if (!Object.keys(data).length) return res.status(400).json({ error: 'no editable fields provided' });
    const row = await prisma.userSymptomReport.updateMany({ where: { id: req.params.id, userId: uid(req) }, data });
    if (!row.count) return res.status(404).json({ error: 'not_found' });
    await invalidateSafetyAdvice(prisma, uid(req), 'symptom_updated').catch(() => null);
    res.json({ updated: true });
  } catch (err) { res.status(500).json({ error: 'symptom_update_failed', detail: err.message }); }
});

router.delete('/restrictions/:id', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const existing = await prisma.userActivityRestriction.findFirst({ where: { id: req.params.id, userId: uid(req) } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (existing.source === 'clinician_documented') {
      await prisma.userActivityRestriction.update({
        where: { id: existing.id },
        data: { status: 'superseded', resolvedAt: new Date(), resolvedBy: 'user_deleted' },
      });
      await invalidateSafetyAdvice(prisma, uid(req), 'restriction_deleted').catch(() => null);
      return res.json({ deleted: true, mode: 'superseded' }); // audit trail kept
    }
    await prisma.userActivityRestriction.deleteMany({ where: { id: existing.id, userId: uid(req) } });
    await invalidateSafetyAdvice(prisma, uid(req), 'restriction_deleted').catch(() => null);
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'restriction_delete_failed', detail: err.message }); }
});

router.delete('/feedback/:id', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const row = await prisma.activitySafetyFeedback.deleteMany({ where: { id: req.params.id, userId: uid(req) } });
    if (!row.count) return res.status(404).json({ error: 'not_found' });
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'feedback_delete_failed', detail: err.message }); }
});

// PATCH /activity-safety/injuries/:id — update status (e.g., recovering/resolved)
// or reassessment date. Explicitly never auto-resolved by elapsed time.
// PATCH /activity-safety/injuries/:id — owner-scoped correction of a
// self-reported injury. Unknown fields are rejected (400) rather than silently
// ignored so clients can't believe a safety-relevant change took effect when
// it didn't. Clinician-documented restriction fields are locked for self-edits:
// overriding them requires a clinician-documented update flow, not a PATCH.
const INJURY_TYPES = new Set(['sprain','fracture','strain','tendinopathy','dislocation','contusion','post_surgical','undiagnosed_pain','other']);
const INJURY_STATUSES = new Set(['current','recovering','resolved']);
const INJURY_LATERALITY = new Set(['left','right','bilateral','na']);
const WB_RESTRICTIONS = new Set(['non_weight_bearing','partial','as_tolerated','full']);
const INJURY_EDITABLE = new Set(['status','type','laterality','painLevel','weightBearingRestriction','rangeOfMotionRestriction','prohibitedCategories','rehabInstructions','notes','expectedReassessmentAt','clearanceRecordedAt','clearanceNote']);
const CLINICIAN_LOCKED = new Set(['weightBearingRestriction','rangeOfMotionRestriction','prohibitedCategories','clearanceRecordedAt','clearanceNote']);

router.patch('/injuries/:id', requireFeature('activity_safety_engine'), async (req, res) => {
  try {
    const prisma = getPrisma();
    const b = body(req);
    const keys = Object.keys(b);
    const unsupported = keys.filter(k => !INJURY_EDITABLE.has(k));
    if (unsupported.length) return res.status(400).json({ error: 'unsupported_fields', unsupported, editable: [...INJURY_EDITABLE] });

    const bad = (field, detail) => res.status(400).json({ error: 'invalid_field', field, detail });
    const data = {};
    if (b.status !== undefined) {
      if (!INJURY_STATUSES.has(b.status)) return bad('status', 'must be one of current|recovering|resolved');
      data.status = b.status;
      data.resolvedAt = b.status === 'resolved' ? new Date() : null;
    }
    if (b.type !== undefined) {
      if (!INJURY_TYPES.has(b.type)) return bad('type', 'unrecognized injury type');
      data.type = b.type;
    }
    if (b.laterality !== undefined) {
      if (!INJURY_LATERALITY.has(b.laterality)) return bad('laterality', 'must be one of left|right|bilateral|na');
      data.laterality = b.laterality;
    }
    if (b.painLevel !== undefined) {
      const p = num(b.painLevel);
      if (b.painLevel !== null && (p === null || p < 0 || p > 10 || !Number.isInteger(p))) return bad('painLevel', 'must be an integer 0-10 or null');
      data.painLevel = p;
    }
    if (b.weightBearingRestriction !== undefined) {
      if (b.weightBearingRestriction !== null && !WB_RESTRICTIONS.has(b.weightBearingRestriction)) return bad('weightBearingRestriction', 'must be one of non_weight_bearing|partial|as_tolerated|full or null');
      data.weightBearingRestriction = b.weightBearingRestriction;
    }
    if (b.rangeOfMotionRestriction !== undefined) {
      if (b.rangeOfMotionRestriction !== null && typeof b.rangeOfMotionRestriction !== 'string') return bad('rangeOfMotionRestriction', 'must be a string or null');
      data.rangeOfMotionRestriction = b.rangeOfMotionRestriction === null ? null : String(b.rangeOfMotionRestriction).slice(0, 200);
    }
    if (b.prohibitedCategories !== undefined) {
      if (!Array.isArray(b.prohibitedCategories)) return bad('prohibitedCategories', 'must be an array of activity category keys');
      const cats = b.prohibitedCategories.map(c => String(c));
      const invalidCats = cats.filter(c => !Object.values(ACTIVITY_CATEGORIES).includes(c));
      if (invalidCats.length) return bad('prohibitedCategories', `unknown categories: ${invalidCats.join(', ')}`);
      data.prohibitedCategories = cats;
    }
    const notes = b.rehabInstructions !== undefined ? b.rehabInstructions : b.notes;
    if (notes !== undefined) {
      if (notes !== null && typeof notes !== 'string') return bad('rehabInstructions', 'must be a string or null');
      data.rehabInstructions = notes === null ? null : String(notes).slice(0, 1000);
    }
    if (b.expectedReassessmentAt !== undefined) {
      const d = b.expectedReassessmentAt === null ? null : new Date(b.expectedReassessmentAt);
      if (b.expectedReassessmentAt !== null && Number.isNaN(d.getTime())) return bad('expectedReassessmentAt', 'must be an ISO date or null');
      data.expectedReassessmentAt = d;
    }
    if (b.clearanceRecordedAt !== undefined || b.clearanceNote !== undefined) {
      if (!b.clearanceRecordedAt || !b.clearanceNote) return bad('clearance', 'clearanceRecordedAt and clearanceNote must be provided together');
      const d = new Date(b.clearanceRecordedAt);
      if (Number.isNaN(d.getTime())) return bad('clearanceRecordedAt', 'must be an ISO date');
      data.clearanceRecordedAt = d;
      data.clearanceNote = String(b.clearanceNote).slice(0, 500);
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'no_editable_fields', editable: [...INJURY_EDITABLE] });

    const existing = await prisma.userInjury.findFirst({ where: { id: req.params.id, userId: uid(req) }, select: { source: true } });
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (existing.source === 'clinician_documented') {
      const locked = keys.filter(k => CLINICIAN_LOCKED.has(k) && b[k] !== undefined);
      if (locked.length) return res.status(409).json({ error: 'clinician_fields_locked', locked, detail: 'These restriction fields were recorded from clinician guidance and cannot be changed by self-report. Ask your clinician for an updated note.' });
    }

    const row = await prisma.userInjury.updateMany({ where: { id: req.params.id, userId: uid(req) }, data });
    if (!row.count) return res.status(404).json({ error: 'not_found' });
    await invalidateSafetyAdvice(prisma, uid(req), 'injury_updated').catch(() => null);
    res.json({ updated: true });
  } catch (err) { res.status(500).json({ error: 'injury_update_failed', detail: err.message }); }
});

module.exports = router;
