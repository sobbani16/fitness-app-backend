// Supplement safety evaluation (v2).
//
// Evaluates a user's selected supplements against:
//   - published SupplementInteractionRule rows (only approved+published rules
//     produce personalized warnings — draft rules never fire),
//   - legacy SupplementAttribute flags matched to health-condition rules,
//   - recorded allergies vs known allergen attributes,
//   - shared nutrient-family cumulative exposure where composition data exists.
//
// Invariants enforced here:
//   - an unapproved rule NEVER produces a blocking/personalized warning,
//   - absence of a matching rule is NEVER reported as proof of safety,
//   - unknown formulation/composition is reported as unknown, not zero-risk.

const ALLERGEN_ATTRIBUTES = {
  DAIRY: ['milk', 'dairy', 'lactose', 'casein', 'whey'],
  CONTAINS_GLUTEN: ['gluten', 'wheat', 'celiac'],
  HIGH_SODIUM: [], // handled via condition rules
};

const CONDITION_MATCH = [
  { key: /thyroid|hypothyroid|hyperthyroid|levothyroxine/i, attributes: ['THYROID_CAUTION'] },
  { key: /pregnan|trying to conceive|prenatal/i, attributes: ['PREGNANCY_CAUTION'] },
  { key: /kidney|ckd|renal/i, attributes: ['HIGH_POTASSIUM'] },
  { key: /hypertension|blood pressure/i, attributes: ['HIGH_SODIUM', 'CONTAINS_CAFFEINE'] },
  { key: /diabet/i, attributes: ['HIGH_SUGAR', 'DIABETES_CAUTION'] },
  { key: /celiac|gluten/i, attributes: ['CONTAINS_GLUTEN'] },
  { key: /anticoag|blood thinner|warfarin|aspirin/i, attributes: ['BLOOD_THINNER_INTERACTION'] },
];

// --- Published-rule trigger evaluation -------------------------------------
// A published rule must NEVER silently pass or silently drop. Each trigger
// type has an explicit evaluator; a type with no evaluator reports
// 'unevaluatable' so the caller can surface "this rule was not checked"
// instead of pretending a negative result.
// Generic tail tokens that must never match a condition on their own —
// 'LIVER_DISEASE' must not fire on 'heart disease'.
const GENERIC_TOKENS = new Set(['disease', 'disorder', 'syndrome', 'deficiency', 'overload', 'significant', 'chronic', 'condition', 'risk', 'exposure']);

// Trigger value conventions in the rules corpus:
//   X_OR_Y         — explicit alternatives ('HEMOCHROMATOSIS_OR_IRON_OVERLOAD')
//   X_Y_Z          — qualifier+core ('SIGNIFICANT_KIDNEY_DISEASE') or a flat
//                    term list ('PREGNANCY_THYROID_LIVER'). Handled by matching
//                    every contiguous n-gram, excluding generic single tokens.
function triggerNgrams(triggerValue) {
  const out = new Set();
  for (const alt of String(triggerValue || '').split('_OR_')) {
    const toks = alt.toLowerCase().split('_').map(t => t.trim()).filter(Boolean);
    for (let i = 0; i < toks.length; i++) {
      for (let j = i + 1; j <= toks.length; j++) {
        const gram = toks.slice(i, j).join(' ');
        if (j - i === 1 && GENERIC_TOKENS.has(gram)) continue;
        out.add(gram);
      }
    }
  }
  return [...out];
}

const LIFE_STAGE_RE = /pregnan|prenatal|expecting|lactat|breastfeed|nursing|postpartum|trying to conceive/i;
const LIFE_STAGE_SUPPORTED = /pregnan|lactat|breastfeed|nursing|trying/i;

// Returns true (fires), false (evaluated, no match), or null (trigger type
// has no evaluator — the rule cannot be checked with loaded data).
function evalRuleTrigger(rule, { conditionNames, allergyNames }) {
  const conds = conditionNames.map(c => String(c).toLowerCase());
  switch (rule.triggerType) {
    case 'CONDITION':
      return triggerNgrams(rule.triggerValue).some(g => conds.some(c => c.includes(g)));
    case 'LIFE_STAGE': {
      if (!LIFE_STAGE_SUPPORTED.test(String(rule.triggerValue || ''))) return null;
      return conds.some(c => LIFE_STAGE_RE.test(c));
    }
    case 'ALLERGY': {
      const terms = String(rule.triggerValue || '').toLowerCase().split('_').filter(t => t && !GENERIC_TOKENS.has(t));
      return terms.some(t => allergyNames.some(a => a.includes(t)));
    }
    // MEDICATION / DOSE_TOTAL / OTHER_SUPPLEMENT / LIFESTYLE / FOOD /
    // LAB_TEST / ADMINISTRATION / PRODUCT_QUALITY / PRODUCT_COMPOSITION /
    // AGE_GROUP — require data sources this check does not load.
    default:
      return null;
  }
}

const DISCLAIMER = 'This check uses only reviewed rules and your recorded information. No interaction found here does not mean a supplement is safe for you — consult a clinician or pharmacist about your medicines and health conditions.';

async function evaluateUserSupplements(prisma, userId) {
  const [links, conditions, allergies, publishedRules, legacyConditionRules] = await Promise.all([
    prisma.userSupplement.findMany({
      where: { userId },
      include: {
        supplement: { include: { attributes: true, ingredient: true, product: { include: { ingredients: { include: { ingredient: true } } } } } },
      },
    }),
    prisma.userHealthCondition.findMany({ where: { userId, active: true }, include: { condition: true } }),
    prisma.userAllergy.findMany({ where: { userId }, include: { allergy: true } }),
    // Only approved + published rules fire. Drafts stay inert by construction.
    prisma.supplementInteractionRule.findMany({ where: { approved: true, reviewStatus: 'PUBLISHED' } }),
    prisma.conditionRule.findMany({ where: { target: 'supplement' } }),
  ]);

  const conditionNames = conditions.map(c => c.condition?.name || '').filter(Boolean);
  const allergyNames = allergies.map(a => (a.allergy?.name || '').toLowerCase()).filter(Boolean);
  const warnings = [];
  const infos = [];
  const exposure = { duplicates: [], cannotVerify: [] };

  // 1. Published interaction rules — none exist until reviewer sign-off.
  const ctx = { conditionNames, allergyNames };
  const unevaluatable = new Map();
  for (const link of links) {
    const slug = link.supplement?.ingredient?.slug;
    const family = link.supplement?.ingredient?.parentFamily;
    for (const rule of publishedRules) {
      if (rule.ingredientSlug !== slug && rule.ingredientSlug !== family) continue;
      const verdict = evalRuleTrigger(rule, ctx);
      if (verdict === null) {
        // Explicit non-result: the rule cannot be checked with the data this
        // evaluation loads — surfaced below, never treated as "no interaction".
        unevaluatable.set(rule.id, rule);
        continue;
      }
      if (verdict) {
        warnings.push({
          kind: 'rule', severity: rule.severity, supplement: link.supplement.name,
          message: rule.consumerWarning, action: rule.ruleAction, evidence: rule.sourceUrl, version: rule.version,
        });
      }
    }
  }
  if (unevaluatable.size) {
    const list = [...unevaluatable.values()];
    const severities = [...new Set(list.map(r => r.severity))];
    infos.push({
      kind: 'rules_not_evaluatable', count: list.length, severities,
      message: `${list.length} published interaction rule(s) could not be checked (trigger types this evaluation does not support). Their absence from warnings means 'not checked', not 'safe' — review with a clinician or pharmacist.`,
    });
  }

  // 2. Legacy attribute flags matched to recorded conditions.
  for (const link of links) {
    const attrs = (link.supplement?.attributes || []).map(a => a.attribute);
    for (const cond of conditionNames) {
      for (const m of CONDITION_MATCH) {
        if (!m.key.test(cond)) continue;
        const hit = attrs.filter(a => m.attributes.includes(a));
        if (hit.length) {
          const approved = legacyConditionRules.find(r => r.attribute && hit.includes(r.attribute) && r.reviewStatus === 'PUBLISHED');
          warnings.push({
            kind: 'attribute', severity: approved ? 'MODERATE' : 'INFO', supplement: link.supplement.name,
            message: `${link.supplement.name} is flagged ${hit.join(', ')} — you have ${cond} recorded. Review with a clinician or pharmacist.`,
            draft: !approved,
          });
        }
      }
    }
  }

  // 3. Allergies vs allergen attributes.
  for (const link of links) {
    const attrs = (link.supplement?.attributes || []).map(a => a.attribute);
    for (const [attr, terms] of Object.entries(ALLERGEN_ATTRIBUTES)) {
      if (!attrs.includes(attr) || !terms.length) continue;
      const hit = allergyNames.find(a => terms.some(t => a.includes(t)));
      if (hit) {
        warnings.push({
          kind: 'allergy', severity: 'HIGH', supplement: link.supplement.name,
          message: `${link.supplement.name} may contain ${attr.toLowerCase().replace(/_/g, ' ')}; you recorded a ${hit} allergy. Check the product label.`,
        });
      }
    }
  }

  // 4. Nutrient-family cumulative exposure.
  const byFamily = {};
  for (const link of links) {
    const fams = (link.supplement?.ingredient?.activeFamilies || link.supplement?.ingredient?.parentFamily || '')
      .split(';').map(s => s.trim()).filter(Boolean);
    for (const f of fams) (byFamily[f] = byFamily[f] || []).push(link);
  }
  for (const [family, members] of Object.entries(byFamily)) {
    if (members.length < 2) continue;
    const withComposition = members.filter(m => (m.supplement?.product?.ingredients || []).length > 0);
    if (withComposition.length === members.length) {
      const totals = {};
      let allKnown = true;
      for (const m of members) {
        for (const pi of m.supplement.product.ingredients) {
          const key = pi.ingredient?.slug || 'unknown';
          if (!pi.amountKnown || pi.amount == null) { allKnown = false; continue; }
          const k = `${key}|${pi.unit || ''}`;
          totals[k] = (totals[k] || 0) + pi.amount;
        }
      }
      exposure.duplicates.push({
        family,
        supplements: members.map(m => m.supplement.name),
        totals: allKnown ? totals : null,
        note: allKnown ? null : 'Some products do not disclose ingredient amounts — total exposure cannot be calculated.',
      });
    } else {
      exposure.duplicates.push({ family, supplements: members.map(m => m.supplement.name), totals: null, note: 'The same nutrient family appears in more than one selected product, but verified composition is missing — total exposure cannot be calculated.' });
    }
  }

  // 5. Information limits — explicit, never silent.
  const unverifiable = links.filter(l => l.supplement?.catalogStatus === 'review_only').map(l => l.supplement.name);
  if (unverifiable.length) {
    infos.push({ kind: 'review_only', message: `${unverifiable.join(', ')} ${unverifiable.length === 1 ? 'is' : 'are'} research-review entries — interaction data is unverified, not absent.` });
  }
  if (publishedRules.length === 0) {
    infos.push({ kind: 'no_published_rules', message: 'Drug-interaction rules are still in clinical review, so no personalized interaction checks ran. Attribute and allergy flags above use catalog data only.' });
  }

  return {
    disclaimers: [DISCLAIMER],
    approvedRulesEvaluated: publishedRules.length,
    rulesNotEvaluatable: unevaluatable.size,
    personalizedChecksPossible: publishedRules.length > 0,
    warnings,
    infos,
    exposure,
    evaluatedAt: new Date().toISOString(),
  };
}

module.exports = { evaluateUserSupplements, evalRuleTrigger, DISCLAIMER };
