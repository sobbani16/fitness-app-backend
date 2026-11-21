// Deterministic decision engine — resolves each candidate situation to ONE of:
//   medical_escalation | professional_review_required | need_more_information | auto_feedback
// Priority order: emergency → allergy/medical restriction → eligibility/life-stage
//   → goal context → data confidence → scoring → recommendation eligibility.
const OUTCOMES = { ESCALATION: 'medical_escalation', REVIEW: 'professional_review_required', ASK: 'need_more_information', FEEDBACK: 'auto_feedback' };

const RED_FLAGS = new Set(['severe_exercise_symptoms', 'blood_in_stool', 'black_stool', 'severe_abdominal_pain', 'vomiting_systemic', 'dizziness_exercise', 'hypoglycemia_symptoms', 'dark_urine_exercise']);
const LIFE_STAGE_BLOCKS = new Set(['under_18', 'pregnancy', 'breastfeeding']);
const MEDICAL_TRIGGERS = new Set(['insulin_carbs_restriction', 'ckd_protein_target', 'medication_interaction', 'conflicting_conditions', 'celiac_gluten_exposure', 'diagnosed_allergen_exposure', 'eating_disorder_risk', 'unintentional_weight_loss_older_adult']);

function resolve({ redFlags = [], restrictions = [], lifeStages = [], medicalTriggers = [], missingInputs = [], dataConfidence = 'reliable' } = {}) {
  if (redFlags.some(f => RED_FLAGS.has(f)))
    return { outcome: OUTCOMES.ESCALATION, suppressOrdinaryCoaching: true, reason: 'Safety symptoms require evaluation, not routine coaching' };
  if (lifeStages.some(l => LIFE_STAGE_BLOCKS.has(l)))
    return { outcome: OUTCOMES.REVIEW, suppressOrdinaryCoaching: true, reason: 'Life-stage pathway — adult wellness targets do not apply' };
  if (medicalTriggers.some(m => MEDICAL_TRIGGERS.has(m)) || restrictions.includes('requires_professional'))
    return { outcome: OUTCOMES.REVIEW, suppressOrdinaryCoaching: false, reason: 'Reviewed individualized guidance required' };
  if (missingInputs.length > 0 && dataConfidence !== 'reliable')
    return { outcome: OUTCOMES.ASK, questions: missingInputs.slice(0, 3), suppressOrdinaryCoaching: false, reason: 'A few details would change the answer' };
  return { outcome: OUTCOMES.FEEDBACK, suppressOrdinaryCoaching: false, reason: 'Deterministic guidance applies' };
}
module.exports = { resolve, OUTCOMES, RED_FLAGS, LIFE_STAGE_BLOCKS, MEDICAL_TRIGGERS };
