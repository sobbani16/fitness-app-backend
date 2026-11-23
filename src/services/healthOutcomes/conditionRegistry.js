// Versioned condition registry — the authoritative catalog of health conditions
// Humai supports. Slugs are stable machine keys; display names can change
// without breaking engine mappings (constants.js CONDITION_KEYS stays the
// activity-safety key map — registry entries carry `engineKey` to bridge).
//
// evidenceClass: 'evidence_based'   — approved lifestyle-evidence rules may apply
//                'education_only'   — surfaces education, never prescriptive rules
//                'supervised_only'  — requires clinician pathway; no automation
//                'allergy'          — handled by the canonical Allergy system
//                'life_stage'       — pregnancy/lactation classifiers, not diseases
//
// A slug not present here is not a supported condition — the API rejects it
// rather than inventing guidance for an unregistered condition.
const REGISTRY = {
  // Group A — metabolic & hormonal
  fatty_liver_masld:      { name: 'Fatty Liver Disease (MASLD)', category: 'metabolic', evidenceClass: 'evidence_based', aliases: ['masld', 'nafld', 'fatty liver', 'fatty liver disease'], education: 'Fatty liver often improves with sustained weight management, activity and dietary quality.' },
  insulin_resistance:     { name: 'Insulin Resistance', category: 'metabolic', evidenceClass: 'evidence_based', aliases: ['insulin resistance'], education: 'Insulin sensitivity responds to activity, sleep and dietary pattern.' },
  prediabetes:            { name: 'Prediabetes', category: 'metabolic', evidenceClass: 'evidence_based', aliases: ['prediabetes', 'pre-diabetes'], education: 'Prediabetes is a high-impact, evidence-supported target for lifestyle change.' },
  type_2_diabetes:        { name: 'Type 2 Diabetes', category: 'metabolic', evidenceClass: 'evidence_based', engineKey: 'diabetes_t2', aliases: ['type 2 diabetes', 'type 2 diabetes mellitus', 't2d'], education: 'Lifestyle supports glucose management; medication decisions stay with your clinician.' },
  obesity:                { name: 'Obesity', category: 'metabolic', evidenceClass: 'evidence_based', engineKey: 'obesity', aliases: ['obesity'], education: 'Sustainable weight change is a marathon of small, measurable habits.' },
  high_triglycerides:     { name: 'High Triglycerides', category: 'metabolic', evidenceClass: 'evidence_based', aliases: ['hypertriglyceridemia', 'high triglycerides', 'elevated triglycerides'], education: 'Triglycerides respond to weight, alcohol, refined-carb and activity changes.' },
  high_ldl_cholesterol:   { name: 'High LDL Cholesterol', category: 'metabolic', evidenceClass: 'evidence_based', aliases: ['high ldl cholesterol', 'elevated ldl', 'hypercholesterolemia'], education: 'LDL responds to dietary fat quality, fiber and activity.' },
  metabolic_syndrome:     { name: 'Metabolic Syndrome', category: 'metabolic', evidenceClass: 'evidence_based', engineKey: 'metabolic_syndrome', aliases: ['metabolic syndrome'], education: 'A cluster of risk factors addressed together through lifestyle.' },
  pcos:                   { name: 'PCOS', category: 'metabolic', evidenceClass: 'evidence_based', aliases: ['pcos', 'polycystic ovary syndrome'], education: 'Activity, weight and dietary pattern support PCOS management.' },
  gout:                   { name: 'Gout', category: 'metabolic', evidenceClass: 'evidence_based', aliases: ['gout'], education: 'Weight, alcohol and purine-context awareness support urate management.' },
  hypothyroidism:         { name: 'Hypothyroidism', category: 'metabolic', evidenceClass: 'education_only', aliases: ['hypothyroidism'], education: 'Thyroid conditions are clinician-managed; lifestyle supports wellbeing.' },
  hyperthyroidism:        { name: 'Hyperthyroidism', category: 'metabolic', evidenceClass: 'education_only', aliases: ['hyperthyroidism'], education: 'Thyroid conditions are clinician-managed; lifestyle supports wellbeing.' },
  // Group B — cardiovascular
  hypertension:           { name: 'Hypertension', category: 'cardiovascular', evidenceClass: 'evidence_based', engineKey: 'hypertension', aliases: ['hypertension', 'high blood pressure'], education: 'Blood pressure responds to sodium awareness, activity and weight.' },
  elevated_cvd_risk:      { name: 'Elevated Cardiovascular Risk', category: 'cardiovascular', evidenceClass: 'evidence_based', aliases: ['elevated cardiovascular risk', 'high cardiovascular risk'], education: 'Combined lifestyle changes lower overall cardiovascular risk.' },
  coronary_artery_disease:{ name: 'Coronary Artery Disease', category: 'cardiovascular', evidenceClass: 'supervised_only', engineKey: 'cad', aliases: ['coronary artery disease', 'cad', 'heart disease'], education: 'Exercise with established heart disease requires clinician-guided clearance.' },
  peripheral_artery_disease: { name: 'Peripheral Artery Disease', category: 'cardiovascular', evidenceClass: 'supervised_only', aliases: ['peripheral artery disease', 'pad'], education: 'Walking programs help, but programs should be clinician-informed.' },
  heart_failure:          { name: 'Heart Failure', category: 'cardiovascular', evidenceClass: 'supervised_only', engineKey: 'heart_failure', aliases: ['heart failure'], education: 'Heart failure requires clinician-guided activity and fluid/sodium care.' },
  post_stroke_recovery:   { name: 'Post-Stroke Recovery', category: 'cardiovascular', evidenceClass: 'supervised_only', engineKey: 'stroke_recovery', aliases: ['post-stroke recovery', 'stroke recovery', 'stroke'], education: 'Rehabilitation should be coordinated with your care team.' },
  // Group C — digestive & liver
  constipation:           { name: 'Constipation', category: 'digestive', evidenceClass: 'evidence_based', aliases: ['constipation', 'chronic constipation'], education: 'Fiber, fluids and activity are first-line supports for regularity.' },
  gerd:                   { name: 'GERD', category: 'digestive', evidenceClass: 'evidence_based', aliases: ['gerd', 'gastroesophageal reflux', 'acid reflux'], education: 'Trigger awareness, weight and meal timing support reflux management.' },
  ibs:                    { name: 'Irritable Bowel Syndrome', category: 'digestive', evidenceClass: 'evidence_based', aliases: ['ibs', 'irritable bowel syndrome'], education: 'IBS management is individualized — fiber type and triggers matter.' },
  functional_bloating:    { name: 'Functional Bloating', category: 'digestive', evidenceClass: 'evidence_based', aliases: ['functional bloating', 'chronic bloating'], education: 'Meal pattern and trigger tracking help identify drivers.' },
  celiac_disease:         { name: 'Celiac Disease', category: 'digestive', evidenceClass: 'evidence_based', aliases: ['celiac disease', 'coeliac disease'], education: 'Strict gluten avoidance is essential; hidden sources need care.' },
  alcohol_related_fld:    { name: 'Alcohol-Related Fatty Liver', category: 'digestive', evidenceClass: 'supervised_only', aliases: ['alcohol-related fatty liver', 'ald'], education: 'Alcohol cessation is primary; support should be clinician-linked.' },
  // Group D — musculoskeletal
  osteoarthritis:         { name: 'Osteoarthritis', category: 'musculoskeletal', evidenceClass: 'evidence_based', engineKey: 'osteoarthritis', aliases: ['osteoarthritis', 'knee osteoarthritis', 'oa'], education: 'Strength and weight management reduce joint load and pain.' },
  chronic_low_back_pain:  { name: 'Chronic Lower Back Pain', category: 'musculoskeletal', evidenceClass: 'evidence_based', aliases: ['chronic lower back pain', 'lower back pain', 'chronic nonspecific low back pain'], education: 'Graded activity usually helps more than rest for chronic back pain.' },
  sarcopenia:             { name: 'Sarcopenia', category: 'musculoskeletal', evidenceClass: 'evidence_based', aliases: ['sarcopenia'], education: 'Resistance training and adequate protein are the core supports.' },
  osteopenia:             { name: 'Osteopenia', category: 'musculoskeletal', evidenceClass: 'evidence_based', engineKey: 'osteoporosis', aliases: ['osteopenia'], education: 'Bone responds to loading; movement choices matter.' },
  osteoporosis:           { name: 'Osteoporosis', category: 'musculoskeletal', evidenceClass: 'evidence_based', engineKey: 'osteoporosis', aliases: ['osteoporosis'], education: 'Exercise helps bone but some movements need modification.' },
  postural_dysfunction:   { name: 'Postural Dysfunction / Deconditioning', category: 'musculoskeletal', evidenceClass: 'evidence_based', aliases: ['postural dysfunction', 'physical deconditioning', 'deconditioning'], education: 'Consistent low-barrier activity rebuilds capacity safely.' },
  // Group E — sleep, mental, respiratory
  obstructive_sleep_apnea:{ name: 'Obstructive Sleep Apnea', category: 'sleep_mental_respiratory', evidenceClass: 'education_only', aliases: ['obstructive sleep apnea', 'osa'], education: 'Weight loss supports OSA; diagnosis and CPAP stay with clinicians.' },
  insomnia:               { name: 'Insomnia', category: 'sleep_mental_respiratory', evidenceClass: 'evidence_based', aliases: ['insomnia', 'chronic insomnia'], education: 'Sleep regularity and CBT-I principles are evidence-based supports.' },
  depression:             { name: 'Depression', category: 'sleep_mental_respiratory', evidenceClass: 'evidence_based', aliases: ['depression', 'major depressive disorder'], education: 'Regular activity measurably supports mood — adjunct, not a cure.' },
  anxiety:                { name: 'Anxiety Disorders', category: 'sleep_mental_respiratory', evidenceClass: 'evidence_based', aliases: ['anxiety', 'anxiety disorders', 'generalized anxiety'], education: 'Activity and sleep regularity support anxiety management.' },
  chronic_stress:         { name: 'Chronic Stress', category: 'sleep_mental_respiratory', evidenceClass: 'evidence_based', aliases: ['chronic stress', 'high stress'], education: 'Recovery practices and activity support stress regulation.' },
  asthma:                 { name: 'Asthma', category: 'sleep_mental_respiratory', evidenceClass: 'evidence_based', engineKey: 'asthma', aliases: ['asthma'], education: 'Activity is encouraged with trigger awareness and medication access.' },
  // Group F — kidney & reproductive
  chronic_kidney_disease: { name: 'Chronic Kidney Disease', category: 'kidney_reproductive', evidenceClass: 'evidence_based', engineKey: 'ckd', aliases: ['chronic kidney disease', 'ckd'], education: 'Kidney-friendly patterns are stage-dependent — labs guide specifics.' },
  kidney_stones:          { name: 'Kidney Stones', category: 'kidney_reproductive', evidenceClass: 'evidence_based', aliases: ['kidney stones', 'nephrolithiasis'], education: 'Hydration is primary; stone type shapes dietary specifics.' },
  gestational_diabetes:   { name: 'Gestational Diabetes', category: 'kidney_reproductive', evidenceClass: 'supervised_only', aliases: ['gestational diabetes', 'gdm'], education: 'GDM nutrition should follow your obstetric team\u2019s guidance.' },
  fertility_metabolic:    { name: 'Fertility (Metabolic-Associated)', category: 'kidney_reproductive', evidenceClass: 'education_only', aliases: ['fertility problems', 'metabolic fertility'], education: 'Metabolic health supports fertility; fertility care stays clinical.' },
  // Non-disease catalog rows already in DB — kept for completeness.
  type_1_diabetes:        { name: 'Type 1 Diabetes', category: 'metabolic', evidenceClass: 'supervised_only', engineKey: 'diabetes_t1', aliases: ['type 1 diabetes', 't1d'], education: 'T1D management is clinician-directed; activity needs glucose planning.' },
  pregnancy:              { name: 'Pregnancy', category: 'life_stage', evidenceClass: 'life_stage', aliases: ['pregnancy', 'pregnant'], education: 'Pregnancy changes nutrition and activity guidance throughout.' },
  iron_deficiency:        { name: 'Iron Deficiency', category: 'metabolic', evidenceClass: 'evidence_based', aliases: ['iron deficiency', 'iron deficiency anemia', 'anemia'], engineKey: 'anemia', education: 'Iron status depends on intake, absorption and cause — labs guide.' },
  lactose_intolerance:    { name: 'Lactose Intolerance', category: 'digestive', evidenceClass: 'evidence_based', aliases: ['lactose intolerance'], education: 'Tolerance varies — many manage with portions and alternatives.' },
  dairy_allergy:          { name: 'Dairy Allergy', category: 'allergy', evidenceClass: 'allergy', aliases: ['dairy allergy', 'milk allergy'], education: 'Managed through the allergy system — always check labels.' },
  egg_allergy:            { name: 'Egg Allergy', category: 'allergy', evidenceClass: 'allergy', aliases: ['egg allergy'], education: 'Managed through the allergy system — always check labels.' },
  nut_allergy:            { name: 'Nut Allergy', category: 'allergy', evidenceClass: 'allergy', aliases: ['nut allergy', 'tree nut allergy', 'peanut allergy'], education: 'Managed through the allergy system — always check labels.' },
  shellfish_allergy:      { name: 'Shellfish Allergy', category: 'allergy', evidenceClass: 'allergy', aliases: ['shellfish allergy'], education: 'Managed through the allergy system — always check labels.' },
  soy_allergy:            { name: 'Soy Allergy', category: 'allergy', evidenceClass: 'allergy', aliases: ['soy allergy'], education: 'Managed through the allergy system — always check labels.' },
};

const SLUGS = Object.keys(REGISTRY);
const ALIAS_TO_SLUG = {};
for (const [slug, meta] of Object.entries(REGISTRY)) {
  ALIAS_TO_SLUG[slug] = slug;
  for (const a of meta.aliases || []) ALIAS_TO_SLUG[a.toLowerCase()] = slug;
  ALIAS_TO_SLUG[meta.name.toLowerCase()] = slug;
}

const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function slugForName(name) {
  const norm = String(name || '').toLowerCase().trim();
  return ALIAS_TO_SLUG[norm] || SLUGS.find(s => s === slugify(name)) || null;
}

/** Catalog for the UI — DB rows enriched with registry metadata. */
async function catalog(prisma) {
  const rows = await prisma.healthCondition.findMany({ orderBy: { name: 'asc' } });
  const bySlug = new Map();
  for (const row of rows) {
    const slug = row.slug || slugForName(row.name);
    const meta = slug ? REGISTRY[slug] : null;
    bySlug.set(slug || `db:${row.id}`, {
      id: row.id, slug: slug || null,
      name: meta?.name || row.name,
      category: meta?.category || row.category || 'other',
      evidenceClass: meta?.evidenceClass || row.evidenceClass || 'education_only',
      education: meta?.education || row.educationSummary || row.description || null,
      registered: !!slug,
    });
  }
  // Registry entries without a DB row still appear (provisional catalog) —
  // rows are materialized on first user write via ensureConditionRow.
  for (const [slug, meta] of Object.entries(REGISTRY)) {
    if (!bySlug.has(slug)) bySlug.set(slug, { id: null, slug, name: meta.name, category: meta.category, evidenceClass: meta.evidenceClass, education: meta.education, registered: true });
  }
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve {slug} or {conditionId} → HealthCondition row; creates the catalog
 * row from the registry when a registered slug has no row yet. Throws 400. */
async function ensureConditionRow(prisma, { slug, conditionId, httpError }) {
  if (conditionId) {
    const row = await prisma.healthCondition.findUnique({ where: { id: conditionId } });
    if (!row) throw httpError(400, 'Unknown condition.');
    return { row, slug: row.slug || slugForName(row.name) };
  }
  const meta = REGISTRY[slug];
  if (!meta) throw httpError(400, 'Unsupported condition. Choose from the conditions list.');
  const bySlug = await prisma.healthCondition.findUnique({ where: { slug } });
  if (bySlug) return { row: bySlug, slug };
  const byName = await prisma.healthCondition.findUnique({ where: { name: meta.name } });
  if (byName) {
    const row = await prisma.healthCondition.update({ where: { id: byName.id }, data: { slug, category: meta.category, evidenceClass: meta.evidenceClass, educationSummary: meta.education } });
    return { row, slug };
  }
  const row = await prisma.healthCondition.create({ data: { name: meta.name, slug, category: meta.category, evidenceClass: meta.evidenceClass, educationSummary: meta.education, registryMeta: { engineKey: meta.engineKey || null } } });
  return { row, slug };
}

const view = (uc) => ({
  id: uc.id,
  conditionId: uc.conditionId,
  slug: uc.condition?.slug || slugForName(uc.condition?.name),
  name: uc.condition?.name || null,
  severity: uc.severity,
  active: uc.active,
  source: uc.source,
  diagnosedAt: uc.diagnosedAt,
  lastConfirmedAt: uc.lastConfirmedAt,
  selfReported: uc.source !== 'clinician_reported',
  notes: uc.notes,
  createdAt: uc.createdAt,
});

async function loadUserConditions(prisma, userId, { includeInactive = false } = {}) {
  const rows = await prisma.userHealthCondition.findMany({
    where: { userId, ...(includeInactive ? {} : { active: true }) },
    include: { condition: { select: { id: true, name: true, slug: true, category: true, evidenceClass: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows;
}

module.exports = { REGISTRY, SLUGS, slugForName, slugify, catalog, ensureConditionRow, loadUserConditions, view };
