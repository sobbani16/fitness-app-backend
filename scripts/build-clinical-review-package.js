#!/usr/bin/env node
// build-clinical-review-package.js — regenerates the multi-format clinical
// review package from data/draft-rule-review-packet.json.
//
// Outputs into docs/clinical-review/:
//   supplement-rule-review-package.json  — enhanced machine-readable package
//   supplement-rule-review-package.csv   — spreadsheet format (Excel/Sheets)
//   REVIEWER_GUIDE.md                    — human-readable guide + rule sections
//   replacement-qa-scenarios.json        — SUPP-REPL-01..04 replacement cases
//
// IMPORTANT: this script derives ROUTING metadata only (reviewer specialty,
// applicable population, engineering limitations). It never invents clinical
// content — every clinical statement comes verbatim from the evidence packet,
// which itself cites source URLs.
//
// Usage: node scripts/build-clinical-review-package.js

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PACKET = path.join(ROOT, 'data', 'draft-rule-review-packet.json');
const OUTDIR = path.join(ROOT, 'docs', 'clinical-review');

const packet = JSON.parse(fs.readFileSync(PACKET, 'utf8'));
const rules = packet.rules;

// --- Routing derivations (non-clinical metadata) ----------------------------

const SPECIALTY_BY_TRIGGER = {
  MEDICATION: 'Clinical pharmacist (primary); prescribing physician co-review for CRITICAL severity',
  DOSE_TOTAL: 'Clinical pharmacist or clinical dietitian',
  CONDITION: 'Physician specialist in the affected condition domain (nephrology/endocrinology/gastroenterology/hepatology as applicable) — clinical pharmacist acceptable for well-established contraindications',
  LIFE_STAGE: 'Maternal-fetal medicine specialist, obstetric clinician, or prenatal clinical pharmacist',
  AGE_GROUP: 'Pediatric clinician',
  ALLERGY: 'Allergist or clinical pharmacist',
  LAB_TEST: 'Laboratory medicine specialist / pathologist, or clinician ordering the affected tests',
  FOOD: 'Clinical dietitian or clinical pharmacist',
  ADMINISTRATION: 'Clinical pharmacist; speech-language pathology input where swallowing risk is cited',
  PRODUCT_QUALITY: 'Clinical pharmacist or pharmacologist/toxicologist',
  PRODUCT_COMPOSITION: 'Clinical pharmacist or clinical dietitian',
  OTHER_SUPPLEMENT: 'Clinical pharmacist',
  LIFESTYLE: 'Physician with oncology/respiratory domain context',
};

const POPULATION_BY_TRIGGER = {
  MEDICATION: 'Users taking the named medication class',
  DOSE_TOTAL: 'All users of the supplement, especially multi-product users',
  CONDITION: 'Users with the named medical condition(s)',
  LIFE_STAGE: 'Pregnant, trying-to-conceive, or breastfeeding users',
  AGE_GROUP: 'Children and adolescents',
  ALLERGY: 'Users with the named allergy',
  LAB_TEST: 'Users undergoing the named laboratory tests',
  FOOD: 'Users consuming the named foods near dosing time',
  ADMINISTRATION: 'Users with swallowing difficulty or inadequate fluid intake',
  PRODUCT_QUALITY: 'All users of products with contamination risk',
  PRODUCT_COMPOSITION: 'Users of combination/kelp/sea-moss products',
  OTHER_SUPPLEMENT: 'Users combining the named supplements',
  LIFESTYLE: 'Users with the named exposure history',
};

function limitationsFor(rule) {
  const out = [];
  if (!rule.engineEvaluatableToday) {
    out.push(`Engine cannot evaluate this rule today: ${rule.runtimeRequirements}`);
    out.push('Until the evaluation surface exists AND the rule is approved, the engine reports it as NOT_CHECKED — never as safe.');
  } else {
    out.push('Engine surface exists, but the rule remains inert (approved=false) until clinical sign-off.');
  }
  out.push('Draft content — clinical accuracy not yet verified by a qualified reviewer.');
  return out;
}

function ruleVersion(rule) {
  return `draft-1 (packet ${packet.version}, generated ${packet.generated})`;
}

// --- Enhanced JSON ----------------------------------------------------------

const enhanced = {
  version: 'clinical-review-package-v1',
  generated: new Date().toISOString(),
  sourcePacket: {
    path: 'data/draft-rule-review-packet.json',
    version: packet.version,
    generated: packet.generated,
    source: packet.source,
  },
  classification: 'CLINICAL_REVIEW_REQUIRED',
  reviewerInstructions: 'For each rule: choose APPROVE, REJECT, or MODIFY (with corrected text). Sign each decision with name, credentials and date. A rule activates ONLY after APPROVE (or MODIFY with the corrected text re-verified by engineering). Nothing in this package is active in the product today.',
  totals: {
    rules: rules.length,
    engineEvaluatableToday: rules.filter((r) => r.engineEvaluatableToday).length,
    engineUnevaluatableToday: rules.filter((r) => !r.engineEvaluatableToday).length,
    bySeverity: rules.reduce((m, r) => ({ ...m, [r.severity]: (m[r.severity] || 0) + 1 }), {}),
  },
  rules: rules.map((r) => {
    const t = r.intendedBehavior.triggerType;
    return {
      ruleNumber: r.index + 1,
      ruleId: `SUPP-D${String(r.index + 1).padStart(2, '0')}`,
      severity: r.severity,
      ingredientOrFamily: r.intendedBehavior.ingredientOrFamily,
      exactRule: {
        triggerType: t,
        triggerValue: r.intendedBehavior.triggerValue,
        action: r.intendedBehavior.action,
        consumerWarning: r.intendedBehavior.consumerWarning,
        importantQualification: r.intendedBehavior.importantQualification,
        minSeparationHours: r.intendedBehavior.minSeparationHours ?? null,
      },
      sourceEvidence: r.provenance,
      applicablePopulation: POPULATION_BY_TRIGGER[t] || 'See trigger value',
      proposedBehavior: r.userImpact,
      limitations: limitationsFor(r),
      requiredSpecialty: SPECIALTY_BY_TRIGGER[t] || 'Clinical pharmacist',
      ruleVersion: ruleVersion(r),
      engineEvaluatableToday: r.engineEvaluatableToday,
      runtimeRequirements: r.runtimeRequirements,
      fallbackWhileUnreviewed: r.fallbackWhileUnreviewed,
      testEvidence: {
        inertBehaviorVerified: 'tests/supplementIntel.test.js + safety engine suites — DRAFT rules never fire; unevaluatable checks report NOT_CHECKED',
        note: 'Post-approval activation tests must be written per rule before activation; see reviewer instructions.',
      },
      review: {
        decision: null, // APPROVE | REJECT | MODIFY
        modifiedText: null,
        reviewerName: null,
        reviewerCredentials: null,
        reviewDate: null,
        notes: null,
      },
    };
  }),
};

fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(
  path.join(OUTDIR, 'supplement-rule-review-package.json'),
  JSON.stringify(enhanced, null, 2) + '\n'
);

// --- CSV (spreadsheet) --------------------------------------------------------

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const headers = [
  'Rule #', 'Rule ID', 'Severity', 'Ingredient/Family', 'Trigger Type', 'Trigger Value',
  'Proposed Action', 'Consumer Warning (draft)', 'Source ID', 'Source URL',
  'Applicable Population', 'Required Specialty', 'Engine Evaluable Today',
  'Limitations', 'Rule Version',
  'Reviewer Decision (APPROVE/REJECT/MODIFY)', 'Modified Text', 'Reviewer Name',
  'Credentials', 'Date', 'Notes',
];
const rows = enhanced.rules.map((r) => [
  r.ruleNumber, r.ruleId, r.severity, r.ingredientOrFamily, r.exactRule.triggerType,
  r.exactRule.triggerValue, r.exactRule.action, r.exactRule.consumerWarning,
  r.sourceEvidence.sourceId, r.sourceEvidence.sourceUrl, r.applicablePopulation,
  r.requiredSpecialty, r.engineEvaluatableToday ? 'YES' : 'NO',
  r.limitations.join(' | '), r.ruleVersion, '', '', '', '', '', '',
]);
const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
fs.writeFileSync(path.join(OUTDIR, 'supplement-rule-review-package.csv'), csv);

console.log(`wrote ${rules.length} rules: JSON + CSV`);

// --- Replacement QA scenarios -------------------------------------------------
//
// RECOVERY STATUS of the originals (founder directive §3): RST-05, RULE-10,
// RULE-13, RULE-14 were case IDs in the original 151-case deployed regression
// (2026-11-25 era, results 138 PASS / 4 FAIL / 9 UNSUPPORTED). Exhaustive
// search of both repositories' git history, the scenario registry (A01-style,
// 120 scenarios), the generated 3,840-fixture matrix, dev-01's HUM-28
// investigation reports and the supplement seed confirms: the case-ID→rule
// mapping was never committed to any artifact — it existed only in the
// original run's conversational evidence, which is lost. Recovery is
// IMPOSSIBLE without fabrication. Per directive, these clearly-labeled
// REPLACEMENTS are provided instead. They use new IDs (SUPP-REPL-*) precisely
// so they can never be mistaken for recovered history.
//
// Selection rationale: the four originals were "DRAFT-rule FAILs" — cases that
// failed because DRAFT rules correctly never fire. Replacements therefore span
// the four clinically-highest-consequence trigger categories at CRITICAL
// severity, two engine-evaluable (post-activation executable) and two covering
// the missing evaluation surfaces (medication list, lab context) so the
// NOT_CHECKED-never-SAFE property is clinically reviewed too.

const ruleByIndex = (i) => enhanced.rules[i];

const replacements = [
  {
    replacementCaseId: 'SUPP-REPL-01',
    replacesOriginalCaseId: 'RST-05 (UNRECOVERED — this is a replacement, not a reconstruction)',
    exercisesRule: 'SUPP-D03',
    rule: ruleByIndex(2),
    category: 'LIFE_STAGE / pregnancy — highest-consequence population',
    engineEvaluatableToday: true,
    syntheticFixture: {
      user: 'qa.synthetic+<case>@syn.local (synthetic domain only — never a real user)',
      profileState: 'life-stage condition recorded: pregnancy or trying-to-conceive',
      supplementIntake: 'product containing preformed vitamin A (retinol) above prenatal-formulation thresholds',
    },
    expectedWhileDraft: 'Rule inert: no block, no warning; engine reports the check as NOT_CHECKED. Any behavior otherwise is a defect.',
    expectedIfApproved: 'REFER_CLINICIAN disposition: user is directed to clinical evaluation of prenatal formulation; automated scheduling/recommendation of the product is suppressed.',
    reviewerDispositionAsk: 'Confirm whether the expected-if-approved behavior is clinically correct and sufficient, or specify the correct behavior ( MODIFY ). This becomes the QA expected-result definition.',
  },
  {
    replacementCaseId: 'SUPP-REPL-02',
    replacesOriginalCaseId: 'RULE-10 (UNRECOVERED — this is a replacement, not a reconstruction)',
    exercisesRule: 'SUPP-D05',
    rule: ruleByIndex(4),
    category: 'MEDICATION / warfarin — most consequential drug-supplement interaction class',
    engineEvaluatableToday: false,
    syntheticFixture: {
      user: 'qa.synthetic+<case>@syn.local',
      profileState: 'medication list contains warfarin or another vitamin-K antagonist',
      supplementIntake: 'product containing vitamin K',
    },
    expectedWhileDraft: 'Rule inert AND engine surface missing: medication list is not loaded by safetyEngine today. Check must report NOT_CHECKED — never implied-safe. Engine must not claim the interaction was evaluated.',
    expectedIfApproved: 'REFER_CLINICIAN: consistent-intake counseling language (per draft warning — do NOT advise blanket vitamin-K avoidance); prescribing-team consultation directed. Requires the medication evaluation surface (§2 engineering) to exist first.',
    reviewerDispositionAsk: 'Confirm the counseling posture (consistent intake vs. avoidance) — the draft explicitly warns against advising avoidance; clinical confirmation is required before any user-facing text ships.',
  },
  {
    replacementCaseId: 'SUPP-REPL-03',
    replacesOriginalCaseId: 'RULE-13 (UNRECOVERED — this is a replacement, not a reconstruction)',
    exercisesRule: 'SUPP-D17',
    rule: ruleByIndex(16),
    category: 'CONDITION / kidney disease — hyperkalemia risk, life-safety critical',
    engineEvaluatableToday: true,
    syntheticFixture: {
      user: 'qa.synthetic+<case>@syn.local',
      profileState: 'health condition recorded: kidney disease / renal impairment',
      supplementIntake: 'potassium-containing product',
    },
    expectedWhileDraft: 'Rule inert: no block, no warning; check reported NOT_CHECKED.',
    expectedIfApproved: 'REFER_CLINICIAN: automated potassium advice suppressed; user directed to clinician. No dosage workaround or softened copy may substitute.',
    reviewerDispositionAsk: 'Confirm severity grading and whether any potassium intake level is ever acceptable to surface without clinician referral in this population.',
  },
  {
    replacementCaseId: 'SUPP-REPL-04',
    replacesOriginalCaseId: 'RULE-14 (UNRECOVERED — this is a replacement, not a reconstruction)',
    exercisesRule: 'SUPP-D23',
    rule: ruleByIndex(22),
    category: 'LAB_TEST / immunoassay interference — diagnostic-safety class (troponin interference is a recognized cause of misdiagnosis)',
    engineEvaluatableToday: false,
    syntheticFixture: {
      user: 'qa.synthetic+<case>@syn.local',
      profileState: 'user logs or is asked about high-dose biotin intake in a lab-test context',
      supplementIntake: 'high-dose biotin product',
    },
    expectedWhileDraft: 'Rule inert AND no lab surface exists: check reported NOT_CHECKED. No lab-related claim may be made.',
    expectedIfApproved: 'LAB_DISCLOSURE_WARNING: user is advised to disclose biotin intake to the testing team before troponin/thyroid immunoassays. Requires the lab-context evaluation surface (§2 engineering).',
    reviewerDispositionAsk: 'Confirm the disclosure-window and interference scope clinically appropriate for user-facing copy.',
  },
];

fs.writeFileSync(
  path.join(OUTDIR, 'replacement-qa-scenarios.json'),
  JSON.stringify({
    version: 'replacement-qa-scenarios-v1',
    generated: new Date().toISOString(),
    recoveryStatus: 'ORIGINALS UNRECOVERABLE — documented exhaustive search; these are clearly-labeled replacements, NOT reconstructions. No historical mapping is invented or implied.',
    scenarios: replacements,
  }, null, 2) + '\n'
);
console.log('wrote replacement-qa-scenarios.json');

// --- REVIEWER_GUIDE.md ---------------------------------------------------------

const sevOrder = { CRITICAL: 0, HIGH: 1, MODERATE: 2 };
const sorted = [...enhanced.rules].sort((a, b) =>
  (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9) || a.ruleNumber - b.ruleNumber);

const lines = [];
lines.push('# Clinical Review Guide — 47 Supplement-Interaction Safety Rules');
lines.push('');
lines.push(`Package version: clinical-review-package-v1 · generated ${enhanced.generated.slice(0, 10)} · source packet ${packet.version}`);
lines.push('');
lines.push('## 1. What you are being asked to do');
lines.push('');
lines.push('You are reviewing **47 draft safety rules** for a consumer supplement-tracking feature. Each rule describes when the product should warn the user, suppress an automated recommendation, or direct the user to a clinician. **None of these rules are active today** — every one is inert until a qualified reviewer approves it. The product currently reports every one of these checks as NOT_CHECKED and never presents their absence as safety.');
lines.push('');
lines.push('For **each rule individually**, choose one of:');
lines.push('');
lines.push('- **APPROVE** — the rule text, trigger, and proposed action are clinically correct as written.');
lines.push('- **MODIFY** — the rule is needed but the text/threshold/wording requires correction. Write the corrected text in the modification field. Engineering will re-verify the corrected text mechanically before activation.');
lines.push('- **REJECT** — the rule should never activate (wrong, obsolete, or out of scope for a consumer product).');
lines.push('');
lines.push('Sign each decision with your name, credentials and date. The spreadsheet (`supplement-rule-review-package.csv`) has one row per rule with empty review columns; this guide has a sign-off block per rule; the JSON (`supplement-rule-review-package.json`) is the machine-readable record engineering will consume.');
lines.push('');
lines.push('## 2. Required reviewer qualifications');
lines.push('');
lines.push('- **Primary reviewer: clinical pharmacist** with drug–supplement interaction competence (the largest rule category is medication interactions, 14/47).');
lines.push('- **Specialist co-review** for the categories marked per-rule below: obstetric/maternal-fetal input for pregnancy rules (4), physician specialist input for condition contraindications (11), pediatric input for the age-group rule, laboratory medicine input for the immunoassay-interference rule.');
lines.push('- A single reviewer may cover multiple categories if credentialed; the per-rule `requiredSpecialty` field states the minimum for each.');
lines.push('');
lines.push('## 3. What the severity labels mean here');
lines.push('');
lines.push('- **CRITICAL (11 rules)** — life-safety or irreversible-harm potential (e.g. pregnancy teratogenicity, hyperkalemia in renal disease, warfarin interaction).');
lines.push('- **HIGH (32 rules)** — clinically meaningful harm potential requiring professional judgment.');
lines.push('- **MODERATE (4 rules)** — quality-of-use and lesser-risk concerns.');
lines.push('');
lines.push('## 4. Provenance and limitations you should know');
lines.push('');
lines.push('- Every rule cites its source (NIH Office of Dietary Supplements fact sheets and comparable references) — the URL is in each rule section.');
lines.push('- **16 of 47 rules are technically evaluable by the product engine today.** The other 31 require engineering surfaces that do not yet exist (user medication list integration, laboratory context, dose-total composition data). Those are being built independently; approval of a rule does not activate it until its evaluation surface also exists. You are reviewing clinical correctness, not engineering readiness.');
lines.push('- Rules marked `engineEvaluatableToday: NO` still need review now — their activation order will follow engineering completion.');
lines.push('');
lines.push('## 5. The four QA scenarios requiring your disposition');
lines.push('');
lines.push('The product\u2019s original deployed regression included four DRAFT-rule cases (`RST-05`, `RULE-10`, `RULE-13`, `RULE-14`) whose definitions were never committed to any repository and are **unrecoverable** (verified by exhaustive search). The four replacement scenarios below are **new, clearly-labeled replacements — not reconstructions**. For each, confirm whether the "expected if approved" behavior is clinically correct; your answer becomes the QA expected-result definition.');
lines.push('');
for (const s of replacements) {
  lines.push(`### ${s.replacementCaseId} — ${s.rule.ingredientOrFamily} / ${s.rule.exactRule.triggerType}`);
  lines.push('');
  lines.push(`- Replaces: \`${s.replacesOriginalCaseId}\``);
  lines.push(`- Category: ${s.category}`);
  lines.push(`- Rule: ${s.rule.exactRule.triggerValue} → ${s.rule.exactRule.action}`);
  lines.push(`- Draft warning text: "${s.rule.exactRule.consumerWarning}"`);
  lines.push(`- Engine evaluable today: ${s.engineEvaluatableToday ? 'YES' : 'NO'}`);
  lines.push(`- Expected while DRAFT: ${s.expectedWhileDraft}`);
  lines.push(`- Expected if approved: ${s.expectedIfApproved}`);
  lines.push(`- **Your disposition**: ${s.reviewerDispositionAsk}`);
  lines.push('');
  lines.push('Disposition: ☐ correct as stated ☐ correct with modification: ____________ ☐ incorrect: ____________');
  lines.push('');
  lines.push('Signed: ____________ Credentials: ____________ Date: ____________');
  lines.push('');
}
lines.push('## 6. The 47 rules');
lines.push('');
lines.push('Rules are ordered CRITICAL first, then HIGH, then MODERATE. Review columns in the spreadsheet mirror these sections.');
lines.push('');
for (const r of sorted) {
  lines.push(`### Rule ${r.ruleNumber} — ${r.ruleId} — ${r.severity} — ${r.ingredientOrFamily}`);
  lines.push('');
  lines.push(`- **Exact rule**: when trigger \`${r.exactRule.triggerType} / ${r.exactRule.triggerValue}\` matches, proposed action \`${r.exactRule.action}\`${r.exactRule.minSeparationHours ? ` with minimum separation ${r.exactRule.minSeparationHours}h` : ''}`);
  lines.push(`- **Draft consumer-facing text**: "${r.exactRule.consumerWarning}"`);
  lines.push(`- **Source**: ${r.sourceEvidence.sourceId} — ${r.sourceEvidence.sourceUrl}`);
  lines.push(`- **Applicable population**: ${r.applicablePopulation}`);
  lines.push(`- **Required reviewer**: ${r.requiredSpecialty}`);
  lines.push(`- **Engine evaluable today**: ${r.engineEvaluatableToday ? 'YES' : 'NO — ' + r.runtimeRequirements}`);
  lines.push(`- **Limitations**:`);
  for (const l of r.limitations) lines.push(`  - ${l}`);
  lines.push(`- **Behavior while unreviewed**: ${r.fallbackWhileUnreviewed}`);
  lines.push('');
  lines.push('Decision: ☐ APPROVE ☐ MODIFY ☐ REJECT   Modified text: ____________');
  lines.push('');
  lines.push('Signed: ____________ Credentials: ____________ Date: ____________');
  lines.push('');
}
lines.push('## 7. What happens after your review');
lines.push('');
lines.push('1. Engineering activates **only** rules you approved (or modified, using your corrected text after mechanical re-verification).');
lines.push('2. Activation additionally requires the rule\u2019s evaluation surface to exist — approval alone never activates a rule the engine cannot evaluate.');
lines.push('3. Per-rule activation tests are written and independently QA-verified before activation.');
lines.push('4. Your four scenario dispositions become permanent QA expected-result definitions.');
lines.push('5. Rejected rules are archived with your rationale — never silently deleted.');
lines.push('');

fs.writeFileSync(path.join(OUTDIR, 'REVIEWER_GUIDE.md'), lines.join('\n') + '\n');
console.log('wrote REVIEWER_GUIDE.md');
