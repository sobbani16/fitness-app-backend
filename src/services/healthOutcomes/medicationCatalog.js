// Medication safety catalog — deliberately LIMITED coverage. This is not a
// drug-interaction database; it maps a curated set of widely prescribed
// medications to coarse safety classes used by recommendation screening.
//
// Authority note: entries mirror drug-class facts from FDA labeling and
// standard pharmacology references (documented in audit doc 17). Entries
// without a confident class are intentionally unclassified — an unclassified
// medication contributes no safety flags, never an invented interaction.
//
// Classes and their safety meanings are documented in
// docs/health-outcomes-implementation/04-MEDICATION-SAFETY.md.
const MED_CLASSES = {
  insulin: { safetyFlags: ['hypoglycemia_risk', 'exercise_glucose_monitoring'], label: 'Insulin' },
  sulfonylurea: { safetyFlags: ['hypoglycemia_risk', 'exercise_glucose_monitoring'], label: 'Sulfonylurea' },
  metformin: { safetyFlags: ['b12_monitoring_context'], label: 'Metformin' },
  sglt2_inhibitor: { safetyFlags: ['dehydration_risk'], label: 'SGLT2 inhibitor' },
  anticoagulant_vit_k: { safetyFlags: ['vitamin_k_consistency'], label: 'Vitamin K antagonist (e.g. warfarin)' },
  anticoagulant_doac: { safetyFlags: [], label: 'Direct oral anticoagulant' },
  ace_inhibitor: { safetyFlags: ['potassium_monitoring'], label: 'ACE inhibitor' },
  arb: { safetyFlags: ['potassium_monitoring'], label: 'ARB' },
  potassium_sparing_diuretic: { safetyFlags: ['potassium_monitoring', 'dehydration_risk'], label: 'Potassium-sparing diuretic' },
  potassium_supplement: { safetyFlags: ['potassium_monitoring'], label: 'Potassium supplement' },
  loop_diuretic: { safetyFlags: ['dehydration_risk', 'electrolyte_monitoring'], label: 'Loop diuretic' },
  thiazide_diuretic: { safetyFlags: ['dehydration_risk', 'electrolyte_monitoring'], label: 'Thiazide diuretic' },
  beta_blocker: { safetyFlags: ['hr_blunting'], label: 'Beta blocker' },
  levothyroxine: { safetyFlags: ['meal_timing_separation'], label: 'Levothyroxine' },
  statin: { safetyFlags: [], label: 'Statin' },
  ssri: { safetyFlags: [], label: 'SSRI' },
  nsaid: { safetyFlags: [], label: 'NSAID' },
  ppi: { safetyFlags: [], label: 'Proton pump inhibitor' },
};

// Curated name → class map. Alias list is intentionally small; unmatched names
// are stored verbatim with class=null and produce no flags.
const NAME_TO_CLASS = {
  insulin: 'insulin', 'insulin glargine': 'insulin', 'insulin lispro': 'insulin', 'insulin aspart': 'insulin', 'insulin detemir': 'insulin', lantus: 'insulin', humalog: 'insulin', novolog: 'insulin', tresiba: 'insulin', 'insulin degludec': 'insulin', 'insulin nph': 'insulin',
  glipizide: 'sulfonylurea', glyburide: 'sulfonylurea', glimepiride: 'sulfonylurea', gliclazide: 'sulfonylurea',
  metformin: 'metformin', glucophage: 'metformin',
  empagliflozin: 'sglt2_inhibitor', dapagliflozin: 'sglt2_inhibitor', canagliflozin: 'sglt2_inhibitor', jardiance: 'sglt2_inhibitor', farxiga: 'sglt2_inhibitor',
  warfarin: 'anticoagulant_vit_k', coumadin: 'anticoagulant_vit_k',
  apixaban: 'anticoagulant_doac', rivaroxaban: 'anticoagulant_doac', dabigatran: 'anticoagulant_doac', eliquis: 'anticoagulant_doac', xarelto: 'anticoagulant_doac',
  lisinopril: 'ace_inhibitor', enalapril: 'ace_inhibitor', ramipril: 'ace_inhibitor', benazepril: 'ace_inhibitor',
  losartan: 'arb', valsartan: 'arb', olmesartan: 'arb', irbesartan: 'arb',
  spironolactone: 'potassium_sparing_diuretic', eplerenone: 'potassium_sparing_diuretic', amiloride: 'potassium_sparing_diuretic', triamterene: 'potassium_sparing_diuretic',
  'potassium chloride': 'potassium_supplement', 'k-dur': 'potassium_supplement',
  furosemide: 'loop_diuretic', bumetanide: 'loop_diuretic', torsemide: 'loop_diuretic', lasix: 'loop_diuretic',
  hydrochlorothiazide: 'thiazide_diuretic', hctz: 'thiazide_diuretic', chlorthalidone: 'thiazide_diuretic', indapamide: 'thiazide_diuretic',
  metoprolol: 'beta_blocker', atenolol: 'beta_blocker', propranolol: 'beta_blocker', carvedilol: 'beta_blocker', bisoprolol: 'beta_blocker', nadolol: 'beta_blocker',
  levothyroxine: 'levothyroxine', synthroid: 'levothyroxine', levoxyl: 'levothyroxine',
  atorvastatin: 'statin', simvastatin: 'statin', rosuvastatin: 'statin', pravastatin: 'statin', lipitor: 'statin', crestor: 'statin',
  sertraline: 'ssri', fluoxetine: 'ssri', escitalopram: 'ssri', citalopram: 'ssri', paroxetine: 'ssri', zoloft: 'ssri', prozac: 'ssri', lexapro: 'ssri',
  ibuprofen: 'nsaid', naproxen: 'nsaid', advil: 'nsaid', aleve: 'nsaid', celecoxib: 'nsaid',
  omeprazole: 'ppi', esomeprazole: 'ppi', pantoprazole: 'ppi', lansoprazole: 'ppi',
};

const normalize = (name) => String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');

function classify(name) {
  return NAME_TO_CLASS[normalize(name)] || null;
}

function safetyFlagsFor(classKeys) {
  const flags = new Set();
  for (const k of classKeys || []) {
    const cls = MED_CLASSES[k];
    if (cls) for (const f of cls.safetyFlags) flags.add(f);
  }
  return flags;
}

/** Deterministic safety flags for a user's active medications. Unclassified
 * meds contribute nothing; the caller may surface them as "unreviewed". */
async function loadMedicationSafetyContext(prisma, userId) {
  let meds = [];
  try {
    meds = await prisma.userMedication.findMany({
      where: { userId, active: true },
      include: { medication: { select: { name: true, medicationClass: true } } },
    });
  } catch { return { flags: new Set(), medications: [], unclassified: [] }; }
  const classes = meds.map(m => m.medicationClass || m.medication?.medicationClass || classify(m.medication?.name || m.nameText)).filter(Boolean);
  const unclassified = meds.filter(m => !(m.medicationClass || m.medication?.medicationClass || classify(m.medication?.name || m.nameText))).map(m => m.nameText);
  return { flags: safetyFlagsFor(classes), medications: meds, classes, unclassified };
}

const STALE_DAYS = 90;
const isStale = (m, now = new Date()) => !m.lastConfirmedAt || (now - new Date(m.lastConfirmedAt)) > STALE_DAYS * 86400000;

module.exports = { MED_CLASSES, NAME_TO_CLASS, classify, normalize, safetyFlagsFor, loadMedicationSafetyContext, isStale, STALE_DAYS };
