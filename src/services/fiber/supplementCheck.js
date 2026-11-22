// Fiber supplement eligibility — psyllium/isabgol and other fiber supplements.
//
// Contract (Phase 7):
//   - Optional pathway only: this module never recommends, prescribes, or
//     logs a dose. It evaluates a user-selected product and returns a
//     verdict with label-derived fiber per serving when — and only when —
//     the label data exists.
//   - Label-verified values or nothing: no teaspoon→gram guessing, no
//     fabricated serving fiber, no default dose.
//   - Fails closed: missing safety or label information suppresses the
//     personalized verdict and returns general education instead.
//   - Every evaluation is persisted to FiberSupplementCheck, including
//     suppressed outcomes, so clinical review sees what was gated and why.
//   - Draft/unapproved interaction rules never produce safety claims;
//     "no published rule" is reported as NOT EVALUATED, not "safe".

const { getPrisma } = require('../../lib/prisma');
const { FIBER_RESTRICTION_PATTERNS, ageFrom } = require('./targets');

const CHECK_VERSION = 'fiber-supplement-check-v1';

// Products we evaluate as fiber supplements — matched on ingredient slug,
// supplement name, or product name. Deliberately narrow: bulk laxatives and
// isolated fibers only, never a blanket "any supplement with fiber".
const FIBER_SUPPLEMENT_RE = /psyllium|isabgol|ispaghula|methylcellulose|wheat[ -]?dextrin|inulin|guar[ -]?gum|acacia[ -]?(fiber|gum)|partially[ -]?hydroly/i;

// Condition patterns specific to fiber-supplement safety (beyond the shared
// restriction list): swallowing, obstruction, fluid restriction.
// Esophageal/swallowing patterns only — intestinal strictures are covered by
// FIBER_RESTRICTION_PATTERNS as gi_stricture, not by the swallowing gate.
const SWALLOW_RE = /dysphagia|swallow|esophageal/i;
const FLUID_RESTRICT_RE = /kidney|renal|ckd|dialysis|heart failure|cardiac|fluid[- ]?restrict/i;
const PREGNANCY_RE = /pregnan|prenatal|expecting/i;
const PSYLLIUM_ALLERGY_RE = /psyllium|isabgol|ispaghula|plantago/i;

const EDUCATION = {
  title: 'About psyllium husk (isabgol)',
  points: [
    'Psyllium is a soluble, gel-forming fiber. Whether and how much to use should follow the product label or a clinician/pharmacist’s advice.',
    'It must always be mixed into adequate liquid — labels commonly call for at least 240 mL (8 fl oz) per dose. Never swallow it dry.',
    'Medicines: psyllium can affect absorption — take it separately from medicines as the label directs (commonly a few hours apart).',
    'Tell a clinician before using it if you have trouble swallowing, any bowel blockage or narrowing, a restricted-fiber diet, kidney/heart fluid limits, or are pregnant.',
    'Stop and seek care for trouble swallowing, chest pain, vomiting, or severe abdominal pain.',
  ],
  source: { name: 'MedlinePlus — psyllium', url: 'https://medlineplus.gov/druginfo/meds/a601104.html', checkedOn: '2026-11-18' },
};

function reason(code, note) { return { code, note }; }

// Reads a fiber-per-serving value from a verified product label only.
// labelFacts is free JSON from label import — look for explicit fiber keys
// and never infer from weight or spoons.
function labelFiber(product) {
  const facts = product?.labelFacts && typeof product.labelFacts === 'object' ? product.labelFacts : null;
  if (!facts) return { fiberG: null, source: null };
  const v = facts.dietaryFiberG ?? facts.fiberG ?? facts.fiber_g ?? facts.fiberPerServingG;
  if (v == null || !Number.isFinite(Number(v)) || Number(v) < 0) return { fiberG: null, source: null };
  return { fiberG: Number(v), source: 'product_label' };
}

function isFiberSupplement({ supplement, product }) {
  const hay = [
    supplement?.name, supplement?.ingredient?.slug, supplement?.ingredient?.name,
    product?.name, supplement?.category,
  ].filter(Boolean).join(' ');
  return FIBER_SUPPLEMENT_RE.test(hay);
}

/**
 * Evaluate a user-selected fiber supplement for eligibility.
 * @param {string} userId
 * @param {{ supplementId?: string, productId?: string, persist?: boolean }} input
 * @returns evaluation object — outcome ∈ eligible | eligible_with_warnings |
 *   suppressed_safety | suppressed_unverified | not_applicable
 */
async function evaluateFiberSupplement(userId, { supplementId, productId, persist = true } = {}) {
  const prisma = getPrisma();
  const reasons = [];
  const warnings = [];
  const infos = [];

  // --- 1. Resolve the exact product the user picked -------------------------
  let supplement = null; let product = null;
  if (productId) {
    product = await prisma.supplementProduct.findUnique({ where: { id: productId }, include: { ingredients: { include: { ingredient: true } } } });
    if (!product) { const e = new Error('Product not found'); e.status = 404; throw e; }
    supplement = await prisma.supplement.findFirst({ where: { productId: product.id }, include: { ingredient: true } });
  } else if (supplementId) {
    supplement = await prisma.supplement.findUnique({ where: { id: supplementId }, include: { ingredient: true, product: { include: { ingredients: { include: { ingredient: true } } } } } });
    if (!supplement) { const e = new Error('Supplement not found'); e.status = 404; throw e; }
    product = supplement.product;
  } else {
    const e = new Error('Provide supplementId or productId.'); e.status = 400; throw e;
  }

  if (supplement?.catalogStatus === 'review_only' || product?.dataSource === 'research_draft') {
    reasons.push(reason('review_only_entry', 'This entry is a research-review record — it is not an approved product suggestion.'));
  }

  if (!isFiberSupplement({ supplement, product })) {
    const out = await record(prisma, persist, {
      userId, supplementId: supplement?.id, productId: product?.id,
      outcome: 'not_applicable',
      reasons: [...reasons, reason('not_fiber_supplement', 'The selected item is not a recognized fiber supplement — this check only evaluates fiber products like psyllium.')],
      labelFiberG: null, servingKnown: false,
    });
    return { ...out, education: EDUCATION, disclaimers: DISCLAIMERS() };
  }

  // --- 2. Product label verification ----------------------------------------
  // Label reasons are tracked separately from safety reasons: an unverified
  // label yields suppressed_unverified, not a safety verdict.
  const labelReasons = [];
  const verified = product && ['LABEL_REVIEWED', 'VERIFIED'].includes(product.verificationStatus);
  const { fiberG: labelFiberG, source: fiberSource } = labelFiber(product);
  const servingKnown = Boolean(verified && labelFiberG != null && (product.servingSize != null || product.servingText));
  if (!verified) {
    labelReasons.push(reason('label_unverified', 'No verified product label on file — fiber per serving cannot be established.'));
  } else if (labelFiberG == null) {
    labelReasons.push(reason('label_fiber_missing', 'The product label does not disclose dietary fiber per serving — amount unknown, not zero.'));
  }
  if (verified && labelFiberG != null && product.servingSize == null && !product.servingText) {
    infos.push({ code: 'serving_size_text_missing', note: 'Label fiber exists but the serving size was not recorded — confirm the serving on the physical label.' });
  }
  // Teaspoon/tablespoon conversions: the label serving unit is echoed back
  // verbatim. If the label serving is grams and the user thinks in spoons,
  // we say "unknown" — we never guess a tsp→g conversion.
  const servingLabel = product ? (product.servingText || (product.servingSize != null && product.servingUnit ? `${product.servingSize} ${product.servingUnit}` : product.servingUnit)) : null;

  // --- 3. Safety gates --------------------------------------------------------
  const [user, conditions, allergies, todayFiberLogs, publishedRules] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true } }),
    prisma.userHealthCondition.findMany({ where: { userId, active: true }, include: { condition: { select: { name: true } } } }).catch(() => []),
    prisma.userAllergy.findMany({ where: { userId }, include: { allergy: { select: { name: true } } } }).catch(() => []),
    prisma.supplementLog.findMany({
      where: { userId, loggedAt: { gte: new Date(Date.now() - 24 * 3600000) } },
      select: { supplementName: true, fiberG: true },
    }).catch(() => []),
    // Only approved+published interaction rules can inform this verdict.
    prisma.supplementInteractionRule.findMany({ where: { approved: true, reviewStatus: 'PUBLISHED' } }).catch(() => []),
  ]);

  const conditionNames = (conditions || []).map((c) => c.condition?.name).filter(Boolean);
  const allergyNames = (allergies || []).map((a) => String(a.allergy?.name || '').toLowerCase()).filter(Boolean);
  const age = ageFrom(user?.dateOfBirth ?? null);

  // Age — pediatric psyllium use is clinician-directed; labels commonly say 12+.
  if (age != null && age < 12) reasons.push(reason('under_12', 'Psyllium products are generally labeled for ages 12+ — pediatric use needs clinician direction.'));
  else if (age != null && age < 18) warnings.push(reason('minor', 'Under 18 — confirm with a clinician or pharmacist before use.'));

  // Swallowing / obstruction / GI narrowing — hard stops.
  for (const cond of conditionNames) {
    if (SWALLOW_RE.test(cond)) reasons.push(reason('swallowing_risk', `Recorded "${cond}" — swallowing difficulty makes dry or under-hydrated psyllium dangerous.`));
    for (const pat of FIBER_RESTRICTION_PATTERNS) {
      if (pat.re.test(cond)) reasons.push(reason(`gi_${pat.kind}`, pat.note));
    }
  }
  if (allergyNames.some((a) => PSYLLIUM_ALLERGY_RE.test(a))) reasons.push(reason('psyllium_allergy', 'A recorded allergy matches psyllium/isabgol.'));

  // Fluid-restricted conditions — the ≥240 mL-per-dose requirement can clash.
  for (const cond of conditionNames) {
    if (FLUID_RESTRICT_RE.test(cond)) warnings.push(reason('fluid_restriction', `Recorded "${cond}" — fiber supplements require a full glass of water per dose, which may conflict with a fluid limit. Ask your clinician.`));
  }
  if (conditionNames.some((c) => PREGNANCY_RE.test(c))) warnings.push(reason('pregnancy', 'Pregnancy recorded — confirm psyllium use with your clinician.'));

  // Medication spacing — only published rules may inform; otherwise unknown.
  const slug = supplement?.ingredient?.slug || supplement?.ingredient?.parentFamily || '';
  const hasRule = publishedRules.some((r) => r.ingredientSlug === slug);
  if (hasRule) {
    warnings.push(reason('published_interaction_rule', 'A reviewed interaction rule exists for this ingredient — follow your label spacing guidance and ask your pharmacist.'));
  } else {
    infos.push({ code: 'medications_not_evaluated', note: 'No reviewed medication-interaction rule exists for this ingredient — interactions are not evaluated, not absent. Labels commonly advise separating psyllium from medicines by a few hours; confirm with your pharmacist.' });
  }

  // Existing fiber supplement today — gentle duplicate check, never a claim
  // that two doses are unsafe; the label's frequency limits apply.
  const fiberToday = (todayFiberLogs || []).filter((l) => FIBER_SUPPLEMENT_RE.test(l.supplementName || '') || (l.fiberG || 0) > 0);
  if (fiberToday.length) infos.push({ code: 'fiber_supplement_already_logged', note: 'A fiber supplement was already logged in the last 24 hours — check the label’s frequency guidance before another serving.' });

  // --- 4. Outcome -------------------------------------------------------------
  // Safety reasons suppress as safety; an unverified/insufficient label
  // suppresses as unverified. Warnings downgrade an otherwise-eligible check.
  let outcome;
  if (reasons.length) outcome = 'suppressed_safety';
  else if (!servingKnown) outcome = 'suppressed_unverified';
  else if (warnings.length) outcome = 'eligible_with_warnings';
  else outcome = 'eligible';

  // --- 5. Directions — label-verbatim + fixed safe-administration points ------
  const directions = [];
  if (product?.warnings) directions.push(product.warnings);
  if (product?.labelFacts?.directions) directions.push(product.labelFacts.directions);
  directions.push('Mix each serving into adequate liquid and drink promptly — labels commonly call for at least 240 mL (8 fl oz).');
  directions.push('Never take psyllium dry.');
  directions.push('Unless the label says otherwise, avoid taking it immediately before bedtime.');

  const check = await record(prisma, persist, {
    userId, supplementId: supplement?.id, productId: product?.id,
    outcome, reasons: [...reasons, ...labelReasons, ...warnings.map((w) => ({ ...w, warning: true })), ...infos],
    labelFiberG: servingKnown ? labelFiberG : null, servingKnown,
  });

  return {
    ...check,
    product: product ? { id: product.id, name: product.name, brand: product.brand, manufacturer: product.manufacturer, serving: servingLabel, verificationStatus: product.verificationStatus, warnings: product.warnings } : null,
    supplement: supplement ? { id: supplement.id, name: supplement.name } : null,
    labelFiberG: servingKnown ? labelFiberG : null,
    servingKnown,
    fiberSource: servingKnown ? fiberSource : null,
    servingLabel,
    reasons: [...reasons, ...labelReasons], warnings, infos,
    directions,
    education: EDUCATION,
    disclaimers: DISCLAIMERS(),
    ruleVersion: CHECK_VERSION,
    evaluatedAt: new Date().toISOString(),
  };
}

function DISCLAIMERS() {
  return [
    'This is an eligibility check, not a recommendation or prescription. No dose was suggested or logged.',
    'Absence of a reviewed interaction rule is not evidence of safety — confirm medicines and conditions with a clinician or pharmacist.',
  ];
}

async function record(prisma, persist, row) {
  if (!persist) return { checkId: null, persisted: false, outcome: row.outcome };
  try {
    const saved = await prisma.fiberSupplementCheck.create({
      data: {
        userId: row.userId, supplementId: row.supplementId ?? null, productId: row.productId ?? null,
        outcome: row.outcome, reasons: row.reasons, labelFiberG: row.labelFiberG,
        servingKnown: row.servingKnown, ruleVersion: CHECK_VERSION,
      },
    });
    return { checkId: saved.id, persisted: true, outcome: row.outcome };
  } catch {
    return { checkId: null, persisted: false, outcome: row.outcome };
  }
}

// Explicit user confirmation — the app may then let the user LOG the product
// themselves via the normal supplement flow. This endpoint only marks that
// the user saw the verdict and chose to proceed; it never writes a log.
async function confirmCheck(userId, checkId) {
  const prisma = getPrisma();
  const check = await prisma.fiberSupplementCheck.findFirst({ where: { id: checkId, userId } });
  if (!check) { const e = new Error('Check not found'); e.status = 404; throw e; }
  if (check.outcome.startsWith('suppressed')) { const e = new Error('This evaluation was suppressed — confirmation is not available.'); e.status = 409; throw e; }
  return prisma.fiberSupplementCheck.update({ where: { id: check.id }, data: { userConfirmed: true, confirmedAt: new Date() } });
}

module.exports = { evaluateFiberSupplement, confirmCheck, EDUCATION, CHECK_VERSION, FIBER_SUPPLEMENT_RE };
