// Activity Safety Engine — deterministic, versioned, multi-dimensional.
//
// Evaluates ONE candidate activity against a normalized safety context:
//   medical          urgent symptoms, rule matches, condition-level escalation
//   functional       injuries, surgeries, restrictions, mobility vs demands
//   environmental    normalized observation vs activity exposure
//   personalization  preferences/rest — can soften, never override safety
//
// The final decision is the highest-ranking dimension outcome
// (DECISION_RANK). Structural safety mechanics (documented restrictions,
// urgent symptoms, missing-material-data conservatism) are ALWAYS ON and
// are not rules — they cannot be disabled by rule review status. Clinical
// content lives in ActivitySafetyRule rows and only the caller-supplied
// `rules` set fires (live callers pass APPROVED-only; tests may pass all).

const { POLICY_VERSION, DECISIONS: D, DECISION_RANK, ACTIVITY_CATEGORIES: C,
  BODY_REGIONS, SYMPTOMS_URGENT, SYMPTOMS_REVIEW, CONDITION_KEYS } = require('./constants');
const { evaluateEnvironment } = require('./environment');

function add(dim, bucket, decision, reason, ruleId) {
  dim.decisions.push(decision);
  dim.reasons.push(reason);
  if (ruleId) dim.ruleIds.push(ruleId);
}
const active = (r, now) => r.status === 'active' && !(r.expiresAt && new Date(r.expiresAt) <= now);
const expired = (r, now) => r.status === 'active' && r.expiresAt && new Date(r.expiresAt) <= now;

// ---------------------------------------------------------------------------
// Medical dimension — symptoms + clinical rules
// ---------------------------------------------------------------------------

function evalMedical(ctx, activity, rules, now) {
  const dim = { status: 'ok', decisions: [], reasons: [], ruleIds: [], requiredData: [] };
  const activeSymptoms = (ctx.symptomReports || []).filter(s => s.status === 'active');
  const urgentCodes = [], reviewCodes = [];
  for (const s of activeSymptoms) {
    for (const code of s.symptoms || []) {
      if (SYMPTOMS_URGENT.has(code)) urgentCodes.push(code);
      else if (SYMPTOMS_REVIEW.has(code)) reviewCodes.push(code);
    }
  }
  if (urgentCodes.length) {
    add(dim, 'medical', D.URGENT_ESCALATION,
      `Active symptom report (${urgentCodes.join(', ')}) may require urgent medical attention — activity is not evaluated further.`);
    return dim; // dominates everything
  }
  for (const code of reviewCodes) {
    add(dim, 'medical', D.NEEDS_CLINICAL_REVIEW,
      `Reported symptom "${code}" should be reviewed before exertion is suggested.`);
  }

  // Rule registry — caller supplies reviewStatus-filtered rows.
  for (const rule of rules || []) {
    if (matchesRule(rule, ctx, activity)) {
      dim.ruleIds.push(rule.ruleCode);
      if (rule.effect && rule.effect !== D.ALLOW) {
        dim.decisions.push(rule.effect);
        dim.reasons.push(rule.reason || `${rule.name} applies.`);
      }
      if (rule.requiredData && rule.requiredData.length) dim.requiredData.push(...rule.requiredData);
    }
  }
  return dim;
}

// AND across specified groups; OR within a group.
function matchesRule(rule, ctx, activity) {
  const a = rule.appliesTo || {};
  const x = rule.exclusion || {};
  const group = (g) => {
    const v = a[g]; return Array.isArray(v) && v.length ? v : null;
  };
  const excluded = (g) => {
    const v = x[g]; return Array.isArray(v) && v.length ? v : null;
  };
  const has = {
    symptomCodes: new Set((ctx.symptomReports || []).filter(s => s.status === 'active').flatMap(s => s.symptoms || [])),
    injuryTypes: new Set((ctx.injuries || []).filter(i => i.status !== 'resolved').map(i => i.type)),
    bodyParts: new Set((ctx.injuries || []).filter(i => i.status !== 'resolved').map(i => i.bodyPart)),
    restrictionCategories: new Set((ctx.restrictions || []).flatMap(r => r.categories || [])),
    conditionKeys: ctx.conditions || new Set(),
    profileFlags: ctx.flags || new Set(),
    activityCategories: new Set(activity.demands.categories),
    envHazards: ctx.envHazards || new Set(),
  };
  for (const g of Object.keys(has)) {
    const need = group(g); if (need && !need.some(k => has[g].has(k))) return false;
    const veto = excluded(g); if (veto && veto.some(k => has[g].has(k))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Functional dimension — injuries, surgeries, restrictions, mobility
// ---------------------------------------------------------------------------

function evalFunctional(ctx, activity, now) {
  const dim = { status: 'ok', decisions: [], reasons: [], ruleIds: [], requiredData: [] };
  const cats = activity.demands.categories;
  const regions = activity.demands.regions || {};
  const wbRegions = Object.keys(regions).filter(r => regions[r] >= 0.5);

  // --- injuries -------------------------------------------------------------
  for (const inj of ctx.injuries || []) {
    if (inj.status === 'resolved') continue;
    const region = BODY_REGIONS[inj.bodyPart];
    if (!region) {
      // Unmapped region + active injury — can't prove demands don't collide.
      if (inj.status === 'current') {
        add(dim, 'functional', D.INSUFFICIENT_DATA,
          `Injury to "${inj.bodyPart}" is not mapped to a movement region — cannot verify activity compatibility.`);
        dim.requiredData.push('injury_region_detail');
      }
      continue;
    }
    const demanded = (regions[region] || 0) >= 0.5;
    const prohibited = (inj.prohibitedCategories || []).some(c => cats.includes(c));
    if (prohibited) {
      add(dim, 'functional', D.BLOCK_ACTIVITY,
        `Documented restriction on ${inj.bodyPart} prohibits this activity category (${inj.prohibitedCategories.join(', ')}).`, 'AS-CORE-002');
      continue;
    }
    if (!demanded) continue; // unaffected region

    const wb = inj.weightBearingRestriction;
    const wbDemanded = activity.demands.weightBearing !== 'none' && region === 'lower_limb';
    if (wb === 'non_weight_bearing' && wbDemanded) {
      add(dim, 'functional', D.BLOCK_ACTIVITY,
        `Active ${inj.bodyPart} injury has a non-weight-bearing restriction — weight-bearing activity on it is blocked.`, 'AS-MSK-001');
    } else if (wb === 'non_weight_bearing' && !wbDemanded) {
      // supported activity on the same limb — still constrained
      add(dim, 'functional', D.MODIFY,
        `Non-weight-bearing ${inj.bodyPart}: only fully supported use is compatible with the restriction.`, 'AS-MSK-001');
    } else if (wb === 'partial' && wbDemanded) {
      add(dim, 'functional', activity.demands.impact === 'high' ? D.BLOCK_ACTIVITY : D.MODIFY,
        `Partial weight-bearing ${inj.bodyPart} — ${activity.demands.impact === 'high' ? 'impact is incompatible' : 'limit load per documented guidance'}.`, 'AS-MSK-001');
    } else if (inj.status === 'current' && (inj.painLevel != null && inj.painLevel >= 7)) {
      add(dim, 'functional', D.NEEDS_CLINICAL_REVIEW,
        `Severe pain (${inj.painLevel}/10) reported at ${inj.bodyPart} — needs evaluation rather than a routine suggestion.`, 'AS-MSK-005');
    } else if (inj.status === 'current') {
      add(dim, 'functional', D.MODIFY,
        `Current ${inj.bodyPart} injury without documented clearance — keep demand on that region light.`, 'AS-MSK-002');
    } else if (inj.status === 'recovering') {
      add(dim, 'functional', D.MODIFY,
        `Recovering ${inj.bodyPart} injury — follow the rehabilitation plan.`, 'AS-MSK-004');
    }
    if (inj.expectedReassessmentAt && new Date(inj.expectedReassessmentAt) <= now) {
      dim.requiredData.push('injury_reassessment');
    }
  }

  // --- surgeries --------------------------------------------------------------
  for (const sx of ctx.surgeries || []) {
    if (sx.status === 'cleared') continue;
    const prohibited = (sx.clinicianRestrictions || []).some(c => cats.includes(c));
    if (prohibited) {
      add(dim, 'functional', D.BLOCK_ACTIVITY,
        `Post-${sx.procedureCategory} restrictions prohibit this activity category.`, 'AS-MSK-008');
      continue;
    }
    const clearance = sx.activityClearance && sx.activityClearance[activity.id];
    if (clearance === 'restricted') {
      add(dim, 'functional', D.BLOCK_ACTIVITY,
        `This activity is listed as restricted in the post-${sx.procedureCategory} guidance.`, 'AS-MSK-008');
    } else if (clearance !== 'cleared' && activity.exertion !== 'light') {
      add(dim, 'functional', D.NEEDS_CLINICAL_REVIEW,
        `Recovery from ${sx.procedureCategory} surgery without documented clearance for this activity — clearance is never inferred from elapsed time.`, 'AS-MSK-008');
    }
    if (sx.reassessAt && new Date(sx.reassessAt) <= now) dim.requiredData.push('surgical_reassessment');
  }

  // --- documented activity restrictions ----------------------------------------
  for (const r of ctx.restrictions || []) {
    if (!['active', 'expired'].includes(r.status)) continue;
    if (r.status === 'expired' || expired(r, now)) {
      if (r.source === 'clinician_documented') {
        add(dim, 'functional', D.NEEDS_CLINICAL_REVIEW,
          'A clinician-documented restriction has passed its expiry/reassessment date — it is not auto-cleared.');
      }
      continue; // self-reported expired restriction → inactive
    }
    const hit = (r.categories || []).some(c => cats.includes(c))
      || (r.bodyRegions || []).some(br => wbRegions.includes(br));
    if (!hit) continue;
    if (r.severity === 'prohibited') {
      add(dim, 'functional', D.BLOCK_ACTIVITY,
        `Active documented restriction (${r.source === 'clinician_documented' ? 'clinician' : 'self-reported'}) prohibits this activity.`, 'AS-CORE-002');
    } else {
      add(dim, 'functional', D.MODIFY,
        'Active documented restriction applies — modify per its guidance.', 'AS-CORE-002');
    }
  }

  // --- mobility & accessibility -------------------------------------------------
  const mob = ctx.mobility || {};
  const needsLegs = activity.demands.weightBearing !== 'none' && regions.lower_limb >= 0.5;
  if ((mob.walkingAbility === 'unable' || mob.wheelchairUser === true) && needsLegs) {
    add(dim, 'functional', D.BLOCK_ACTIVITY,
      'This activity requires lower-limb weight-bearing that does not match your mobility profile — accessible alternatives are evaluated instead.');
  } else if (mob.wheelchairUser === true && regions.lower_limb >= 0.5) {
    add(dim, 'functional', D.MODIFY,
      'This supported activity still uses the lower limbs — suitability depends on your individual function and accessible setup.');
  } else if (mob.walkingAbility === 'limited' && needsLegs) {
    add(dim, 'functional', D.MODIFY, 'Walking ability is limited — keep duration and surface conservative.');
  }
  if (mob.balanceLimitation && activity.demands.balance !== 'low') {
    add(dim, 'functional', D.MODIFY, 'Balance limitation noted — this activity has high balance demands; a supported option may suit better.');
  }
  if (mob.standingToleranceMin != null && mob.standingToleranceMin < 15
    && activity.demands.weightBearing === 'full' && activity.exertion !== 'light') {
    add(dim, 'functional', D.MODIFY, 'Limited standing tolerance — keep it short with seated breaks.');
  }

  // --- pregnancy & postpartum (voluntary profile field only) ---------------------
  if (ctx.pregnancyStatus === 'pregnant') {
    if (cats.includes(C.CONTACT_FALL_RISK) || cats.includes(C.SUPINE_PROLONGED) || cats.includes(C.VALSALVA)) {
      add(dim, 'functional', D.MODIFY,
        'Pregnancy: this activity pattern (contact/fall-risk, prolonged supine, or straining) warrants modification per ACOG guidance.', 'AS-PREG-001');
    }
    // uncomplicated pregnancy is never categorically blocked
  } else if (ctx.pregnancyStatus === 'postpartum' && ctx.postpartumWeeks != null && ctx.postpartumWeeks < 12
    && activity.exertion === 'vigorous') {
    add(dim, 'functional', D.MODIFY,
      'Early postpartum — keep intensity gradual per ACOG return-to-activity guidance.', 'AS-PREG-005');
  }
  return dim;
}

// ---------------------------------------------------------------------------
// Personalization dimension — can soften/annotate, never override safety
// ---------------------------------------------------------------------------

function evalPersonalization(ctx) {
  const dim = { status: 'ok', decisions: [], reasons: [], ruleIds: [], suppress: false, boost: false };
  const p = ctx.preferences || {};
  if (p.restRequested || p.restDay) {
    dim.suppress = true;
    dim.reasons.push('Rest requested or scheduled — nothing is suggested. Rest is a valid choice.');
    return dim;
  }
  if ((p.activityPreferences || []).length) dim.boost = true;
  if (p.workoutPlanned) dim.reasons.push('A workout is planned today — suggestions respect your plan.');
  return dim;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function mergeDimensions(dims) {
  let decision = D.ALLOW;
  const order = [dims.medical, dims.functional, dims.environmental];
  for (const d of order) for (const dec of d.decisions || []) {
    if ((DECISION_RANK[dec] || 0) > (DECISION_RANK[decision] || 0)) decision = dec;
  }
  // Personalization may soften (suppress suggestions) but never raise severity.
  return decision;
}

/**
 * evaluateActivity({ context, activity, env, rules, now })
 * context: normalized safety context (see context.js).
 * activity: catalog entry (activityCatalog.js).
 * env: normalized environmental observation or null.
 * rules: ActivitySafetyRule rows (caller filters reviewStatus; may be []).
 * now: Date for lifecycle checks.
 */
function evaluateActivity({ context = {}, activity, env = null, rules = [], now = new Date() }) {
  if (!activity || !activity.demands) throw new Error('activity with demands is required');
  const ctx = normalizeContext(context);
  const flags = buildFlags(ctx);
  const environmental = evaluateEnvironment(env, activity, flags);
  ctx.envHazards = new Set(environmental.hazards || []);

  const dimensions = {
    medical: evalMedical(ctx, activity, rules, now),
    functional: evalFunctional(ctx, activity, now),
    environmental,
    personalization: evalPersonalization(ctx),
  };
  const decision = mergeDimensions(dimensions);

  const ruleIds = [...new Set(['medical', 'functional', 'environmental'].flatMap(k => dimensions[k].ruleIds || []))];
  const reasons = [...new Set(['medical', 'functional', 'environmental'].flatMap(k => dimensions[k].reasons || []))];
  const requiredData = [...new Set(['medical', 'functional', 'environmental'].flatMap(k => dimensions[k].requiredData || []))];
  const restrictions = [...new Set((ctx.restrictions || []).filter(r => active(r, now)).flatMap(r => r.categories || [])
    .concat((ctx.injuries || []).filter(i => i.status !== 'resolved').flatMap(i => i.prohibitedCategories || [])))];

  return {
    candidateActivityId: activity.id,
    decision,
    dimensions,
    ruleIds,
    reasons,
    restrictions,
    requiredData,
    allowedAlternatives: [], // populated by the pipeline across candidates
    evidenceReferences: ruleIds,
    suppressed: dimensions.personalization.suppress === true,
    betterTime: dimensions.environmental.betterTime || null,
    policyVersion: POLICY_VERSION,
    evaluatedAt: now.toISOString(),
  };
}

// Build the flag set the environmental/rules matching uses.
function buildFlags(ctx) {
  const flags = new Set(ctx.conditions || []);
  if (ctx.pregnancyStatus === 'pregnant') flags.add('pregnancy');
  if (ctx.ageYears != null && ctx.ageYears >= 65) flags.add('age_65_plus');
  if (ctx.mobility && ctx.mobility.wheelchairUser) flags.add('wheelchair');
  for (const f of ctx.medicationFlags || []) flags.add(f);
  if (flags.size) flags.add('med_flags');
  return flags;
}

// Normalize raw context input into the shape the engine expects.
function normalizeContext(c) {
  const conditions = new Set();
  for (const name of c.conditions || []) {
    const key = CONDITION_KEYS[String(name).toLowerCase().trim()];
    if (key) conditions.add(key);
  }
  for (const k of c.conditionKeys || []) conditions.add(k);
  return {
    ...c,
    conditions,
    flags: c.flags instanceof Set ? c.flags : new Set(c.flags || []),
    symptomReports: c.symptomReports || c.symptoms || [],
    injuries: c.injuries || [],
    surgeries: c.surgeries || [],
    restrictions: c.restrictions || [],
    mobility: c.mobility || {},
    medicationFlags: c.medicationFlags || [],
    preferences: c.preferences || {},
  };
}

module.exports = { evaluateActivity, matchesRule, normalizeContext, buildFlags, DECISIONS: D };
