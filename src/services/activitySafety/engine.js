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
  BODY_REGIONS, SYMPTOMS_URGENT, SYMPTOMS_REVIEW, SYMPTOM_ALIASES, CONDITION_KEYS } = require('./constants');
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
    for (const raw of s.symptoms || []) {
      const code = SYMPTOM_ALIASES[raw] || raw; // canonical registry — legacy codes escalate identically
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

  // Rule registry — caller supplies reviewStatus-filtered rows. Rules whose
  // required input cannot be collected safely/accurately stay inactive.
  for (const rule of rules || []) {
    if (rule.inputStatus === 'unsupported_input') continue;
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
// Wildcards: '__always__' trivially satisfies its group; '__any__' requires
// at least one value present in the context set.
function matchesRule(rule, ctx, activity) {
  const a = rule.appliesTo || {};
  const x = rule.exclusion || {};
  const group = (g) => {
    const v = a[g]; return Array.isArray(v) && v.length ? v : null;
  };
  const excluded = (g) => {
    const v = x[g]; return Array.isArray(v) && v.length ? v : null;
  };
  // Token semantics: OR within a group; 'a+b' = conjunction inside one token;
  // '__match_activity__' (restrictionCategories only) = the activity demands a
  // category the user is restricted on — never a blanket "any restriction".
  const satisfied = (tokens, set, g) => {
    if (!tokens) return true;
    if (tokens.includes('__always__')) return true;
    if (tokens.includes('__any__')) return set.size > 0;
    if (g === 'restrictionCategories' && tokens.includes('__match_activity__'))
      return (activity.demands.categories || []).some(c => set.has(c));
    return tokens.some(t => t.split('+').every(k => set.has(k)));
  };
  const has = {
    symptomCodes: new Set((ctx.symptomReports || []).filter(s => s.status === 'active').flatMap(s => (s.symptoms || []).map(c => SYMPTOM_ALIASES[c] || c))),
    injuryTypes: new Set((ctx.injuries || []).filter(i => i.status !== 'resolved').map(i => i.type)),
    bodyParts: new Set((ctx.injuries || []).filter(i => i.status !== 'resolved').map(i => i.bodyPart)),
    restrictionCategories: new Set((ctx.restrictions || []).flatMap(r => r.categories || [])),
    conditionKeys: ctx.conditions || new Set(),
    profileFlags: ctx.flags || new Set(),
    activityCategories: new Set(activity.demands.categories),
    envHazards: ctx.envHazards || new Set(),
  };
  for (const g of Object.keys(has)) {
    if (!satisfied(group(g), has[g], g)) return false;
    const veto = excluded(g);
    if (veto && !veto.includes('__always__') && !veto.includes('__any__') && veto.some(k => has[g].has(k))) return false;
    if (veto && veto.includes('__any__') && has[g].size > 0) return false;
    if (veto && veto.includes('__always__')) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Functional dimension — injuries, surgeries, restrictions, mobility
// ---------------------------------------------------------------------------

// Clearance precedence (Phase 17 §2): resolves a surgery's activityClearance
// into an explicit scoped result. Shapes supported:
//   legacy map:  { outdoor_walk: 'cleared', general: 'cleared', '*': 'restricted' }
//   entries:     { entries: [{ activityId | scope:'general', status,
//                   effectiveAt, expiresAt, documentedBy }] }  (or bare array)
// Rules: activity-specific beats general; 'restricted' beats 'cleared' at equal
// scope; not-yet-effective and expired records are ignored; a clearance only
// ever affects the SURGERY dimension — it cannot suppress injury, restriction,
// symptom or environmental decisions (those merge by rank elsewhere).
function resolveClearance(sx, activityId, now) {
  const ac = sx.activityClearance || {};
  const entries = [];
  if (Array.isArray(ac.entries)) {
    for (const e of ac.entries) entries.push({ scope: e.scope || (e.activityId ? 'activity' : 'general'), activityId: e.activityId, status: e.status, effectiveAt: e.effectiveAt, expiresAt: e.expiresAt });
  } else if (Array.isArray(ac)) {
    for (const e of ac) entries.push({ scope: e.scope || (e.activityId ? 'activity' : 'general'), activityId: e.activityId, status: e.status, effectiveAt: e.effectiveAt, expiresAt: e.expiresAt });
  } else {
    for (const [k, v] of Object.entries(ac)) {
      if (typeof v === 'object' && v) entries.push({ scope: k === 'general' || k === '*' ? 'general' : 'activity', activityId: k, status: v.status, effectiveAt: v.effectiveAt, expiresAt: v.expiresAt });
      else entries.push({ scope: k === 'general' || k === '*' ? 'general' : 'activity', activityId: k, status: v === true ? 'cleared' : v });
    }
  }
  const match = entries.filter(e =>
    (e.activityId === activityId || e.scope === 'general')
    && ['cleared', 'restricted'].includes(e.status)
    && !(e.expiresAt && new Date(e.expiresAt) <= now)
    && !(e.effectiveAt && new Date(e.effectiveAt) > now));
  const specific = match.filter(e => e.activityId === activityId);
  const pick = specific.length ? specific : match;
  const best = pick.find(e => e.status === 'restricted') || pick[0];
  if (!best) return { status: 'none', scope: null, effectiveAt: null, expiresAt: null };
  return { status: best.status, scope: best.activityId === activityId ? 'activity' : 'general', effectiveAt: best.effectiveAt || null, expiresAt: best.expiresAt || null };
}

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
    // Weight-bearing is a load on the limb even when the limb doesn't move —
    // a standing press is incompatible with a lower-limb NWB restriction
    // regardless of regions.lower_limb.
    const wb = inj.weightBearingRestriction;
    const wbDemanded = region === 'lower_limb' && activity.demands.weightBearing !== 'none';
    if (!demanded && !wbDemanded) continue; // unaffected region
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
    const cl = resolveClearance(sx, activity.id, now);
    if (cl.status === 'restricted') {
      add(dim, 'functional', D.BLOCK_ACTIVITY,
        `This activity is listed as restricted in the post-${sx.procedureCategory} guidance.`, 'AS-MSK-008');
    } else if (cl.status !== 'cleared' && activity.exertion !== 'light') {
      add(dim, 'functional', D.NEEDS_CLINICAL_REVIEW,
        `Recovery from ${sx.procedureCategory} surgery without documented clearance for this activity — clearance is never inferred from elapsed time.`, 'AS-MSK-008');
    }
    if (cl.status !== 'none') dim.clearances = [...(dim.clearances || []), { surgery: sx.procedureCategory, activityId: activity.id, status: cl.status, scope: cl.scope, effectiveAt: cl.effectiveAt || null, expiresAt: cl.expiresAt || null }];
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
  const flags = buildFlags(ctx, now);
  const environmental = evaluateEnvironment(env, activity, flags);
  ctx.envHazards = new Set(environmental.hazards || []);
  // Post-env derivations for rule matching — env state is only known here.
  if (environmental.status === 'unknown') flags.add('env_unknown');
  if (environmental.status === 'stale') flags.add('env_stale');
  if ((ctx.activityPreferences || []).includes(activity.id)) flags.add('preference_match');
  ctx.flags = flags;

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

const HOUR_MS = 3600 * 1000;

// Build the flag set environmental/rules matching uses. Every flag must come
// from a validated ctx field — never inferred from free text — and must be
// listed in DERIVABLE_PROFILE_FLAGS so the review package can audit coverage.
function buildFlags(ctx, now) {
  // Caller-supplied flags (producer state, test fixtures) merge with derived
  // flags — derivations add to, never discard, provided context.
  const flags = new Set(ctx.flags instanceof Set ? ctx.flags : (ctx.flags || []));
  for (const c of ctx.conditions || []) flags.add(c);
  if (ctx.pregnancyStatus === 'pregnant') flags.add('pregnancy');
  if (ctx.pregnancyStatus === 'postpartum') flags.add('postpartum');
  if (ctx.ageYears != null && ctx.ageYears >= 65) flags.add('age_65_plus');
  if (ctx.mobility && ctx.mobility.wheelchairUser) flags.add('wheelchair');
  for (const f of ctx.medicationFlags || []) flags.add(f);
  if (flags.size) flags.add('med_flags');

  // Injury/restriction lifecycle — documented, server-side data only.
  const t = now ? new Date(now).getTime() : Date.now();
  const activeInjuries = (ctx.injuries || []).filter(i => i.status !== 'resolved');
  if (activeInjuries.some(i => i.weightBearingRestriction === 'non_weight_bearing')) flags.add('wb_non_weight_bearing');
  if (activeInjuries.some(i => i.injuredAt && t - new Date(i.injuredAt).getTime() <= 72 * HOUR_MS)) flags.add('acute_injury_72h');
  if (activeInjuries.some(i => i.painLevel != null && i.painLevel >= 7)) flags.add('severe_undiagnosed_pain');
  if (activeInjuries.some(i => i.status === 'recovering')) flags.add('rehab_plan_active');
  if ((ctx.surgeries || []).some(s => s.status !== 'cleared'
    && !s.activityClearance && !(s.clinicianRestrictions || []).length)) flags.add('post_surgical_undocumented');

  const symptoms = new Set((ctx.symptomReports || []).filter(s => s.status === 'active')
    .flatMap(s => (s.symptoms || []).map(c => SYMPTOM_ALIASES[c] || c)));
  if (symptoms.has('hypoglycemia')) flags.add('recent_hypoglycemia');
  if (symptoms.has('joint_instability') || activeInjuries.some(i => String(i.type).includes('instability'))) flags.add('joint_instability');

  // Screening completeness — honest missing-data signals, never a safe status.
  if (ctx.profilePresent === false) flags.add('screening_incomplete');
  if ((ctx.ageYears != null && ctx.ageYears >= 60) || (ctx.conditions || new Set()).size > 0 || ctx.pregnancyStatus === 'pregnant') flags.add('risk_flags_present');
  if (ctx.mobility && ctx.mobility.balanceLimitation) { flags.add('fall_risk'); if (ctx.ageYears != null && ctx.ageYears >= 65) flags.add('frailty'); }

  // User-declared state — the gate maps these into ctx.preferences.
  const pref = ctx.preferences || {};
  if (pref.restRequested) flags.add('rest_requested');
  if (pref.restDay) flags.add('rest_day');
  if (pref.workoutPlanned) flags.add('workout_planned');
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
