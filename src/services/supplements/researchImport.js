// Supplement research import pipeline (v1).
//
// Deterministic, idempotent, dry-run capable import of the
// humai_supplement_research_seed dataset. Three staged paths:
//
//   ENRICH_EXISTING -> link the 34 legacy catalog rows to canonical
//                      ingredients + draft education. IDs, user selections,
//                      logs and schedules are preserved untouched.
//   ADD_CANDIDATE   -> new catalog rows (catalogStatus='candidate') with
//                      draft education; not published as reviewed claims.
//   REVIEW_ONLY     -> restricted research records (catalogStatus='review_only')
//                      for identification/tracking only. Never suggested.
//
// Safety rules import as approved=false drafts — none are activated.
// Nothing in this module invents doses, references, or review status.

const crypto = require('node:crypto');

const VALID_IMPORT_ACTIONS = new Set(['ENRICH_EXISTING', 'ADD_CANDIDATE', 'REVIEW_ONLY']);
const VALID_SOURCE_SCOPES = new Set(['INGREDIENT_SPECIFIC', 'CATEGORY_REVIEW', 'CATEGORY_INDEX', 'GENERAL_POLICY']);
const VALID_PRODUCTION_CODES = new Set(['DIET_REQUIRED', 'NO_ELEMENT_SYNTHESIS', 'ENDOGENOUS', 'PARTIAL', 'ESSENTIAL_FAT', 'PROTEIN_FOOD', 'NONESSENTIAL_PLANT', 'NONESSENTIAL_OTHER', 'MICROBE', 'BLEND', 'HORMONE']);
const VALID_EVIDENCE_CLASSES = new Set(['NUTRIENT_ROLE_ESTABLISHED', 'CONTEXT_DEPENDENT', 'PERFORMANCE_CONTEXT', 'COMPOSITION', 'MICROBE_STRAIN', 'LIMITED_MIXED', 'INSUFFICIENT', 'HIGH_RISK']);
const VALID_SEVERITIES = new Set(['INFO', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL']);

// Chemical/form suffix tokens per family. Only items whose name resolves to
// "<family> <formToken>" (or an explicit whole-name token like "Ubiquinol")
// become SupplementForm rows; everything else is a standalone ingredient in
// that family. Kept deliberately small — guessing formulations is worse than
// missing one.
const FORM_TOKENS = {
  magnesium: ['glycinate', 'bisglycinate', 'citrate', 'oxide', 'malate', 'threonate', 'chloride', 'sulfate', 'taurate', 'orotate'],
  calcium: ['citrate', 'carbonate', 'gluconate', 'lactate', 'hydroxyapatite'],
  'vitamin-d': ['d3', 'd2', 'cholecalciferol', 'ergocalciferol'],
  'vitamin-b12': ['methylcobalamin', 'cyanocobalamin', 'adenosylcobalamin', 'hydroxocobalamin'],
  'vitamin-k': ['k1', 'k2', 'mk-4', 'mk-7', 'phylloquinone', 'menaquinone'],
  coq10: ['ubiquinol', 'ubiquinone'],
  creatine: ['monohydrate', 'hcl', 'hydrochloride'],
  iron: ['bisglycinate', 'gluconate', 'sulfate', 'fumarate'],
  zinc: ['picolinate', 'citrate', 'gluconate', 'oxide', 'acetate'],
  selenium: ['selenomethionine', 'selenite'],
  potassium: ['citrate', 'chloride', 'gluconate'],
};

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// "Vitamin D3 (cholecalciferol)" -> { base: "Vitamin D3", paren: "cholecalciferol" }
function splitName(name) {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(String(name || '').trim());
  if (!m) return { base: String(name || '').trim(), paren: null };
  return { base: m[1].trim(), paren: m[2].trim() };
}

function normalizeLookup(value) {
  return slugify(value).replace(/-/g, ' ');
}

function firstFamily(activeFamilies) {
  const raw = String(activeFamilies || '').split(';').map(s => s.trim()).filter(Boolean);
  return raw.length ? slugify(raw[0]) : null;
}

// Detect "<family> <form>" items — e.g. "Magnesium glycinate" is a form of
// magnesium; "Vitamin D3 (cholecalciferol)" a form of vitamin-d. Matches a
// form token anywhere in the name's word set so "vitamin d3" resolves even
// though the family prefix is not followed by a space.
function detectForm(baseName, family) {
  if (!family || !FORM_TOKENS[family]) return null;
  const tokens = normalizeLookup(baseName).split(' ').filter(Boolean);
  const hit = tokens.find(t => FORM_TOKENS[family].includes(t));
  return hit ? slugify(hit) : null;
}

function buildAliases(item) {
  const { base, paren } = splitName(item.name);
  const aliases = new Set();
  if (Array.isArray(item.aliases)) for (const a of item.aliases) if (a && String(a).trim()) aliases.add(String(a).trim());
  if (paren) aliases.add(paren);
  // "Turmeric / Curcumin" -> both halves are lookup names.
  for (const part of base.split('/')) {
    const t = part.trim();
    if (t && t !== base) aliases.add(t);
  }
  if (base !== item.name) aliases.add(base);
  return [...aliases];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateItem(item, index, seenNames, sourceIds) {
  const errors = [];
  const label = item && item.name ? `"${item.name}"` : `item #${index}`;
  if (!item || typeof item !== 'object') return [`item #${index}: not an object`];
  if (!item.name || typeof item.name !== 'string' || !item.name.trim()) errors.push(`${label}: missing name`);
  if (item.name && item.name.length > 160) errors.push(`${label}: name too long`);
  if (!VALID_IMPORT_ACTIONS.has(item.import_action)) errors.push(`${label}: bad import_action ${item.import_action}`);
  if (item.body_production_code && !VALID_PRODUCTION_CODES.has(item.body_production_code)) errors.push(`${label}: unknown body_production_code ${item.body_production_code}`);
  if (item.evidence_class && !VALID_EVIDENCE_CLASSES.has(item.evidence_class)) errors.push(`${label}: unknown evidence_class ${item.evidence_class}`);
  if (item.source_scope && !VALID_SOURCE_SCOPES.has(item.source_scope)) errors.push(`${label}: unknown source_scope ${item.source_scope}`);
  if (item.source_url && !/^https:\/\/[\w.-]+/.test(item.source_url)) errors.push(`${label}: source_url not https or malformed`);
  if (item.source_id && !sourceIds.has(item.source_id)) errors.push(`${label}: source_id ${item.source_id} not in sources[]`);
  if (item.review_status !== 'UNREVIEWED_RESEARCH_DRAFT') errors.push(`${label}: unexpected review_status ${item.review_status}`);
  if (item.suggestion_auto_enabled === true) errors.push(`${label}: suggestion_auto_enabled must be false in draft data`);
  if (item.default_schedule_active === true) errors.push(`${label}: default_schedule_active must be false in draft data`);
  if (item.default_dose != null) errors.push(`${label}: default_dose present — draft data must not carry doses`);
  if (item.reviewed_by != null || item.reviewed_at != null) errors.push(`${label}: reviewed fields must be null in draft data`);
  const key = normalizeLookup(item.name || '');
  if (key && seenNames.has(key)) errors.push(`${label}: duplicate normalized name`);
  seenNames.add(key);
  return errors;
}

function validateSafetyRule(rule, index) {
  const errors = [];
  const label = `rule #${index} (${rule && rule.ingredient_or_family})`;
  if (!rule || typeof rule !== 'object') return [`rule #${index}: not an object`];
  if (!rule.ingredient_or_family || !String(rule.ingredient_or_family).trim()) errors.push(`${label}: missing ingredient_or_family`);
  if (!rule.trigger_type) errors.push(`${label}: missing trigger_type`);
  if (!rule.trigger_value) errors.push(`${label}: missing trigger_value`);
  if (!rule.consumer_warning) errors.push(`${label}: missing consumer_warning`);
  if (!VALID_SEVERITIES.has(rule.severity)) errors.push(`${label}: severity ${rule.severity} not in INFO|LOW|MODERATE|HIGH|CRITICAL`);
  if (!rule.rule_action) errors.push(`${label}: missing rule_action`);
  if (rule.approved === true) errors.push(`${label}: approved=true must never arrive in a draft import`);
  if (rule.source_url && !/^https:\/\//.test(rule.source_url)) errors.push(`${label}: source_url not https`);
  return errors;
}

function validateDataset(data) {
  const errors = [];
  const rejected = [];
  if (!data || typeof data !== 'object') return { errors: ['dataset is not an object'], rejected };
  if (!Array.isArray(data.items)) errors.push('items[] missing');
  if (!Array.isArray(data.sources)) errors.push('sources[] missing');
  if (!Array.isArray(data.safety_rules_draft)) errors.push('safety_rules_draft[] missing');
  if (errors.length) return { errors, rejected };

  const sourceIds = new Set(data.sources.map(s => s && s.id).filter(Boolean));
  const seenNames = new Set();
  data.items.forEach((item, i) => {
    for (const e of validateItem(item, i, seenNames, sourceIds)) {
      errors.push(e);
      rejected.push({ index: i, name: item && item.name, reason: e });
    }
  });
  data.safety_rules_draft.forEach((rule, i) => {
    for (const e of validateSafetyRule(rule, i)) {
      errors.push(e);
      rejected.push({ index: i, rule: rule && rule.ingredient_or_family, reason: e });
    }
  });
  return { errors, rejected };
}

// Minimal CSV reader good enough for the supplied exports (quoted, commas, BOM).
function parseCsv(text) {
  const rows = [];
  let cur = [''], inQuotes = false, field = 0;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur[field] += '"'; i += 1; } else inQuotes = false;
      } else cur[field] += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { field += 1; cur[field] = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      if (cur.length > 1 || cur[0] !== '') { rows.push(cur); }
      cur = ['']; field = 0;
    } else cur[field] += c;
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  return rows;
}

// Cross-check the companion CSVs against the JSON (validation aid only —
// the JSON remains the source of truth).
function csvConsistency(data, catalogCsv, safetyCsv) {
  const out = { catalogRows: null, catalogMissing: [], catalogExtra: [], safetyRows: null, safetyMissing: [], safetyExtra: [] };
  if (catalogCsv) {
    const rows = parseCsv(catalogCsv);
    out.catalogRows = Math.max(0, rows.length - 1);
    const csvNames = new Set(rows.slice(1).map(r => normalizeLookup(r[0])));
    const jsonNames = new Set(data.items.map(i => normalizeLookup(i.name)));
    out.catalogMissing = [...jsonNames].filter(n => !csvNames.has(n));
    out.catalogExtra = [...csvNames].filter(n => !jsonNames.has(n));
  }
  if (safetyCsv) {
    const rows = parseCsv(safetyCsv);
    out.safetyRows = Math.max(0, rows.length - 1);
    const csvKeys = new Set(rows.slice(1).map(r => `${slugify(r[0])}|${r[1]}|${r[2]}`));
    const jsonKeys = new Set(data.safety_rules_draft.map(r => `${slugify(r.ingredient_or_family)}|${r.trigger_type}|${r.trigger_value}`));
    out.safetyMissing = [...jsonKeys].filter(k => !csvKeys.has(k));
    out.safetyExtra = [...csvKeys].filter(k => !jsonKeys.has(k));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

async function upsertIngredient(tx, item, family) {
  const { base } = splitName(item.name);
  const formKey = detectForm(base, family);
  const ingredientSlug = formKey ? family : slugify(base);
  const data = {
    name: formKey ? family.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : base,
    category: item.category || null,
    parentFamily: family,
    activeFamilies: item.active_ingredient_families || null,
    productionCode: item.body_production_code || null,
    evidenceClass: item.evidence_class || null,
    researchStatus: item.review_status || 'UNREVIEWED_RESEARCH_DRAFT',
  };
  const ingredient = await tx.supplementIngredient.upsert({
    where: { slug: ingredientSlug },
    update: { parentFamily: data.parentFamily, activeFamilies: data.activeFamilies },
    create: { slug: ingredientSlug, ...data },
  });
  let form = null;
  if (formKey) {
    form = await tx.supplementForm.upsert({
      where: { slug: `${family}-${formKey}` },
      update: { ingredientId: ingredient.id, name: base },
      create: {
        ingredientId: ingredient.id,
        slug: `${family}-${formKey}`,
        name: base,
        formKey,
        researchStatus: item.review_status || 'UNREVIEWED_RESEARCH_DRAFT',
      },
    });
  }
  return { ingredient, form, formKey };
}

async function upsertAliases(tx, ingredient, item) {
  let created = 0;
  for (const alias of buildAliases(item)) {
    const normalized = normalizeLookup(alias);
    if (!normalized) continue;
    const existing = await tx.supplementAlias.findUnique({
      where: { ingredientId_normalized: { ingredientId: ingredient.id, normalized } },
    });
    if (!existing) {
      await tx.supplementAlias.create({ data: { ingredientId: ingredient.id, alias, normalized } });
      created += 1;
    }
  }
  return created;
}

function educationData(item, ids) {
  const cautions = [];
  if (item.primary_safety_notes) cautions.push(item.primary_safety_notes);
  if (item.clinical_or_medical_caution) cautions.push('Flagged for clinical/medical caution — clinician or pharmacist review recommended before use guidance.');
  return {
    ingredientId: ids.ingredientId,
    formId: ids.formId,
    supplementId: ids.supplementId,
    overview: item.purpose_why_body_uses_it || null,
    whatItIs: item.purpose_why_body_uses_it || null,
    physiologicalRole: item.purpose_why_body_uses_it || null,
    isEssentialNutrient: item.body_production_code === 'DIET_REQUIRED' ? true
      : ['NONESSENTIAL_PLANT', 'NONESSENTIAL_OTHER', 'BLEND'].includes(item.body_production_code) ? false : null,
    bodyProduces: item.body_production_code || null,
    productionExplanation: item.body_production_explanation || null,
    timingCode: item.timing_code || null,
    timingSuggestion: item.suggested_timing || null,
    timingRationale: item.timing_rationale || null,
    timingStrength: item.timing_strength || null,
    relativeAnchor: item.preferred_relative_anchor || null,
    labelExceptions: item.product_label_required ? 'Product label required for serving size and dose.' : null,
    adverseEffects: item.primary_safety_notes || null,
    interactionCautions: cautions.length ? cautions.join(' ') : null,
    regulatoryNotes: item.review_notes || null,
    evidenceClass: item.evidence_class || null,
    evidenceMeaning: item.evidence_meaning || null,
    reviewStatus: 'DRAFT',
    lastEvidenceUpdate: item.source_checked_on ? new Date(item.source_checked_on) : null,
  };
}

async function upsertEducationSource(tx, educationId, item, sourceRegistry) {
  if (!item.source_url && !item.source_id) return { missing: true };
  const source = item.source_id ? sourceRegistry[item.source_id] : null;
  const existing = await tx.supplementEducationSource.findFirst({
    where: { educationId, sourceKey: item.source_id || null, url: item.source_url || '' },
  });
  const data = {
    educationId,
    sourceKey: item.source_id || null,
    title: source ? source.title : null,
    url: item.source_url || (source ? source.url : ''),
    scope: item.source_scope || (source ? source.scope : null),
    itemSpecific: Boolean(item.source_is_item_specific),
    checkedOn: item.source_checked_on ? new Date(item.source_checked_on) : null,
    supportsClaims: item.source_is_item_specific
      ? ['physiological_role', 'production_explanation', 'timing_guidance', 'safety_notes']
      : [],
    reviewerStatus: 'UNREVIEWED',
  };
  if (existing) await tx.supplementEducationSource.update({ where: { id: existing.id }, data });
  else await tx.supplementEducationSource.create({ data });
  return { missing: false };
}

async function importSafetyRules(tx, rules, ingredientBySlug) {
  const result = { imported: 0, skipped: 0, collisions: [] };
  const seen = new Set();
  for (let i = 0; i < rules.length; i += 1) {
    const r = rules[i];
    const slug = slugify(r.ingredient_or_family);
    let dedupeKey = `${slug}|${r.trigger_type}|${r.trigger_value}`;
    if (seen.has(dedupeKey)) {
      result.collisions.push(dedupeKey);
      dedupeKey = `${dedupeKey}|${i}`;
    }
    seen.add(dedupeKey);
    const ingredient = ingredientBySlug[slug]
      || Object.values(ingredientBySlug).find(g => g.parentFamily === slug)
      || null;
    const data = {
      ingredientSlug: slug,
      ingredientId: ingredient ? ingredient.id : null,
      triggerType: r.trigger_type,
      triggerValue: r.trigger_value,
      consumerWarning: r.consumer_warning,
      severity: r.severity,
      ruleAction: r.rule_action,
      minSeparationHours: r.min_separation_hours != null ? Number(r.min_separation_hours) : null,
      sourceUrl: r.source_url || null,
      sourceId: r.source_id || null,
      approved: false, // drafts are never auto-approved
      requiresReviewerSignoff: r.requires_reviewer_signoff !== false,
      qualification: r.important_qualification || null,
      reviewStatus: 'DRAFT',
      version: 1,
      dedupeKey,
    };
    await tx.supplementInteractionRule.upsert({
      where: { dedupeKey },
      update: { consumerWarning: data.consumerWarning, severity: data.severity, ruleAction: data.ruleAction, minSeparationHours: data.minSeparationHours, sourceUrl: data.sourceUrl, sourceId: data.sourceId, qualification: data.qualification, ingredientId: data.ingredientId },
      create: data,
    });
    result.imported += 1;
  }
  return result;
}

/**
 * Run the import. `apply=false` performs a full dry-run inside a transaction
 * that is rolled back — every write path is exercised, nothing persists.
 */
async function importResearch(prisma, data, { apply = false } = {}) {
  const validation = validateDataset(data);
  const audit = {
    apply,
    startedAt: new Date().toISOString(),
    dataset: {
      items: data.items.length,
      enrichExisting: data.items.filter(i => i.import_action === 'ENRICH_EXISTING').length,
      addCandidate: data.items.filter(i => i.import_action === 'ADD_CANDIDATE').length,
      reviewOnly: data.items.filter(i => i.import_action === 'REVIEW_ONLY').length,
      safetyRules: data.safety_rules_draft.length,
      cleanupFindings: (data.cleanup_audit || []).length,
      schemaRecommendations: (data.recommended_schema || []).length,
      declaredCounts: data.metadata ? {
        existing_catalog_count: data.metadata.existing_catalog_count,
        new_candidate_count: data.metadata.new_candidate_count,
        total_rows: data.metadata.total_rows,
        draft_safety_rules: data.metadata.draft_safety_rules,
        review_only_count: data.metadata.review_only_count,
      } : null,
    },
    validation,
    results: {
      ingredientsUpserted: 0,
      formsUpserted: 0,
      aliasesCreated: 0,
      supplements: { existingMapped: [], candidatesAdded: [], reviewOnly: [], archived: [], notFoundExisting: [], errors: [] },
      education: { upserted: 0, sourcesLinked: 0, missingSources: [] },
      safetyRules: { imported: 0, approvedCount: 0, collisions: [] },
      preserved: {},
      requiresReview: [],
      needsDecision: [],
    },
  };
  if (validation.errors.length) {
    audit.aborted = 'validation failed — nothing imported';
    return audit;
  }

  const sourceRegistry = Object.fromEntries((data.sources || []).map(s => [s.id, s]));
  const R = audit.results;

  const work = async (tx) => {
    // Preservation snapshot — counts before writing, verified after.
    const [usBefore, logBefore, schedBefore] = await Promise.all([
      tx.userSupplement.count(), tx.supplementLog.count(), tx.supplementSchedule.count(),
    ]);
    R.preserved = { userSupplementsBefore: usBefore, supplementLogsBefore: logBefore, schedulesBefore: schedBefore };

    // Reference counts for the "Test Supplement" cleanup decision.
    const testSupp = await tx.supplement.findUnique({ where: { name: 'Test Supplement' } });
    if (testSupp) {
      const [us, logs, scheds] = await Promise.all([
        tx.userSupplement.count({ where: { supplementId: testSupp.id } }),
        tx.supplementLog.count({ where: { userSupplement: { supplementId: testSupp.id } } }),
        tx.supplementSchedule.count({ where: { supplementId: testSupp.id } }),
      ]);
      if (us + logs + scheds === 0) {
        // Safe to archive: no user data depends on it. Archived rows are
        // excluded from catalog listing/search but the row + history survive.
        R.archiveTestSupplement = { references: 0, action: 'archived' };
      } else {
        R.needsDecision.push({ entity: 'Test Supplement', references: { userSupplements: us, logs, schedules: scheds }, reason: 'has FK references — archive/remove requires approval' });
      }
    }

    const ingredientBySlug = {};

    for (const item of data.items) {
      try {
        const family = firstFamily(item.active_ingredient_families);
        const { ingredient, form, formKey } = await upsertIngredient(tx, item, family);
        ingredientBySlug[ingredient.slug] = ingredient;
        if (!ingredientBySlug[slugify(splitName(item.name).base)]) ingredientBySlug[slugify(splitName(item.name).base)] = ingredient;
        R.ingredientsUpserted += 1;
        if (form) R.formsUpserted += 1;
        R.aliasesCreated += await upsertAliases(tx, ingredient, item);

        // Map to the Supplement catalog row.
        const catalogStatus = item.import_action === 'ENRICH_EXISTING' ? 'published'
          : item.import_action === 'ADD_CANDIDATE' ? 'candidate' : 'review_only';
        const suppData = {
          ingredientId: ingredient.id,
          formId: form ? form.id : null,
          catalogStatus,
          reviewStatus: item.review_status || 'UNREVIEWED_RESEARCH_DRAFT',
          category: item.category === 'Existing catalog' ? undefined : (item.category || undefined),
        };
        let supplement;
        if (item.import_action === 'ENRICH_EXISTING') {
          const existing = await tx.supplement.findUnique({ where: { name: item.name } });
          if (!existing) {
            R.supplements.notFoundExisting.push(item.name);
            supplement = await tx.supplement.upsert({
              where: { name: item.name },
              update: suppData,
              create: { name: item.name, isDefault: false, ...suppData },
            });
          } else {
            supplement = await tx.supplement.update({ where: { id: existing.id }, data: suppData });
            R.supplements.existingMapped.push({ name: item.name, id: existing.id, form: formKey });
          }
        } else {
          supplement = await tx.supplement.upsert({
            where: { name: item.name },
            update: suppData,
            create: { name: item.name, isDefault: false, ...suppData },
          });
          if (item.import_action === 'ADD_CANDIDATE') R.supplements.candidatesAdded.push(item.name);
          else R.supplements.reviewOnly.push(item.name);
        }
        if (item.name === 'Test Supplement' && R.archiveTestSupplement) {
          await tx.supplement.update({ where: { id: supplement.id }, data: { catalogStatus: 'archived' } });
          R.supplements.archived.push(item.name);
        }
        if (item.requires_clinical_review || item.clinical_or_medical_caution || String(item.review_notes || '').includes('hold')) {
          R.requiresReview.push(item.name);
        }

        // Education record (draft) — one per catalog row.
        const eduData = educationData(item, { ingredientId: ingredient.id, formId: form ? form.id : null, supplementId: supplement.id });
        const existingEdu = await tx.supplementEducation.findUnique({ where: { supplementId: supplement.id } });
        const education = existingEdu
          ? await tx.supplementEducation.update({ where: { id: existingEdu.id }, data: eduData })
          : await tx.supplementEducation.create({ data: eduData });
        R.education.upserted += 1;
        const src = await upsertEducationSource(tx, education.id, item, sourceRegistry);
        if (src.missing) R.education.missingSources.push(item.name);
        else R.education.sourcesLinked += 1;
      } catch (err) {
        R.supplements.errors.push({ name: item.name, error: err.message });
      }
    }

    // Safety rules — always approved=false drafts.
    const rulesResult = await importSafetyRules(tx, data.safety_rules_draft, ingredientBySlug);
    R.safetyRules = { ...rulesResult, approvedCount: 0 };

    const [usAfter, logAfter, schedAfter] = await Promise.all([
      tx.userSupplement.count(), tx.supplementLog.count(), tx.supplementSchedule.count(),
    ]);
    R.preserved.userSupplementsAfter = usAfter;
    R.preserved.supplementLogsAfter = logAfter;
    R.preserved.schedulesAfter = schedAfter;
    R.preserved.intact = usBefore === usAfter && logBefore === logAfter;
  };

  if (apply) {
    await prisma.$transaction(work, { timeout: 120000, maxWait: 15000 });
  } else {
    try {
      await prisma.$transaction(async (tx) => {
        await work(tx);
        throw new Error('__DRY_RUN_ROLLBACK__');
      }, { timeout: 120000, maxWait: 15000 });
    } catch (err) {
      if (err.message !== '__DRY_RUN_ROLLBACK__') throw err;
    }
  }

  audit.finishedAt = new Date().toISOString();
  audit.summary = {
    itemsProcessed: R.ingredientsUpserted,
    errors: R.supplements.errors.length,
    educationRecords: R.education.upserted,
    sourcesLinked: R.education.sourcesLinked,
    missingSources: R.education.missingSources.length,
    safetyRulesImported: R.safetyRules.imported,
    safetyRulesApproved: R.safetyRules.approvedCount,
    requiresReview: R.requiresReview.length,
    userDataPreserved: R.preserved.intact,
  };
  return audit;
}

module.exports = {
  importResearch,
  validateDataset,
  csvConsistency,
  slugify,
  splitName,
  detectForm,
  buildAliases,
  parseCsv,
  _internal: { FORM_TOKENS, firstFamily, normalizeLookup },
};
