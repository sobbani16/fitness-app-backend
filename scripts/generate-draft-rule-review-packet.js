#!/usr/bin/env node
// Generates the clinical-review packet for draft SupplementInteractionRule
// rows sourced from data/imports/humai_supplement_research_seed_v1.json.
// Each entry carries: provenance, intended behavior, review status, runtime
// requirements, user impact, and the interim fallback — the fields reviewers
// need to sign off or reject. Rules remain DRAFT; this packet changes nothing.
const fs = require('fs');
const path = require('path');

const SEED = path.join(__dirname, '..', 'data', 'imports', 'humai_supplement_research_seed_v1.json');
const OUT = path.join(__dirname, '..', 'data', 'draft-rule-review-packet.json');

// What each trigger type needs at runtime before the rule can be evaluated.
const RUNTIME_REQUIREMENTS = {
  CONDITION: 'recorded user health conditions (loaded by safetyEngine)',
  LIFE_STAGE: 'recorded life-stage conditions (pregnancy/lactation patterns)',
  ALLERGY: 'recorded user allergies (loaded by safetyEngine)',
  MEDICATION: 'user medication list — NOT loaded by safetyEngine (no medication surface exists)',
  DOSE_TOTAL: 'per-ingredient dose totals across the user\'s stack — composition data required',
  OTHER_SUPPLEMENT: 'full supplement stack cross-reference (loaded links)',
  LIFESTYLE: 'user lifestyle factors (smoking/occupational exposure) — no such profile field',
  FOOD: 'recent food log context — not loaded by safetyEngine',
  LAB_TEST: 'lab result records — no lab surface exists',
  ADMINISTRATION: 'dosage-form/administration metadata on the product',
  PRODUCT_QUALITY: 'third-party purity/contamination data per product — not in schema',
  PRODUCT_COMPOSITION: 'full strain/species-level product composition — not in schema',
  AGE_GROUP: 'user date of birth → age band — user row not loaded by safetyEngine',
};

const USER_IMPACT = {
  CRITICAL: 'unchecked rule could miss a severe harm (contraindicated use)',
  HIGH: 'unchecked rule could miss a clinically meaningful interaction',
  MODERATE: 'unchecked rule could miss a moderate-risk advisory',
};

const data = JSON.parse(fs.readFileSync(SEED, 'utf8'));
const rules = data.safety_rules_draft;

const evaluatable = new Set(['CONDITION', 'LIFE_STAGE', 'ALLERGY']);
const packet = {
  version: 'draft-rule-review-v1',
  generated: new Date().toISOString(),
  source: 'data/imports/humai_supplement_research_seed_v1.json:safety_rules_draft',
  classification: 'CLINICAL_REVIEW_REQUIRED',
  disclaimer: 'All rules remain DRAFT (approved=false, reviewStatus!=PUBLISHED) and never fire. This packet is review input, not activation.',
  totals: {
    rules: rules.length,
    engineEvaluatable: rules.filter(r => evaluatable.has(r.trigger_type)).length,
    engineUnevaluatable: rules.filter(r => !evaluatable.has(r.trigger_type)).length,
  },
  rules: rules.map((r, i) => ({
    index: i,
    provenance: { sourceId: r.source_id, sourceUrl: r.source_url },
    intendedBehavior: {
      ingredientOrFamily: r.ingredient_or_family,
      triggerType: r.trigger_type,
      triggerValue: r.trigger_value,
      action: r.rule_action,
      consumerWarning: r.consumer_warning,
      importantQualification: r.important_qualification || null,
      minSeparationHours: r.min_separation_hours ?? null,
    },
    reviewStatus: {
      approved: !!r.approved,
      requiresReviewerSignoff: !!r.requires_reviewer_signoff,
      current: 'DRAFT',
    },
    runtimeRequirements: RUNTIME_REQUIREMENTS[r.trigger_type] || `no evaluator for trigger type ${r.trigger_type}`,
    engineEvaluatableToday: evaluatable.has(r.trigger_type),
    userImpact: USER_IMPACT[r.severity] || USER_IMPACT.MODERATE,
    severity: r.severity,
    fallbackWhileUnreviewed: 'Rule is inert — never produces a blocking or personalized warning. If approved while its trigger type is unevaluatable, safetyEngine reports it under rules_not_evaluatable as "not checked", never as a silent pass.',
  })),
};

fs.writeFileSync(OUT, JSON.stringify(packet, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${packet.totals.rules} rules (${packet.totals.engineEvaluatable} evaluatable, ${packet.totals.engineUnevaluatable} unevaluatable)`);
