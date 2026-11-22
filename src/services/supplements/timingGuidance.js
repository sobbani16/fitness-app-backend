// SupplementTimingGuidanceService — maps research timing codes to qualified,
// user-facing suggestions. Timing is convenience/label context, never medical
// direction; LABEL_DEPENDENT and TIMING_REVIEW entries never produce a
// confident suggestion.

const TIMING_COPY = {
  WITH_FAT_MEAL: {
    suggestion: 'With a meal that contains some fat — breakfast or lunch are convenient options, not a requirement.',
    required: 'optional',
    anchor: 'MEAL',
    confidence: 'moderate',
  },
  WITH_MEAL: {
    suggestion: 'With a meal — often better tolerated, and some products absorb better with food.',
    required: 'optional',
    anchor: 'MEAL',
    confidence: 'moderate',
  },
  ANY_TIME: {
    suggestion: 'Any consistent time of day — no established universally better hour.',
    required: 'optional',
    anchor: 'ANY',
    confidence: 'high',
  },
  WITH_WATER: {
    suggestion: 'With a full glass of water. Follow the label and any medication-spacing guidance.',
    required: 'optional',
    anchor: 'ANY',
    confidence: 'moderate',
  },
  PRE_WORKOUT_OPTIONAL: {
    suggestion: 'Before a workout only if that is why you take it and you tolerate it — not a universal need.',
    required: 'optional',
    anchor: 'PRE_WORKOUT',
    confidence: 'low',
  },
  POST_WORKOUT_OPTIONAL: {
    suggestion: 'After a workout if convenient — total daily intake generally matters more than exact timing.',
    required: 'optional',
    anchor: 'POST_WORKOUT',
    confidence: 'low',
  },
  BEDTIME_OPTIONAL: {
    suggestion: 'In the evening or near bedtime only if that matches why you take it.',
    required: 'optional',
    anchor: 'BEDTIME',
    confidence: 'low',
  },
  EMPTY_IF_DIRECTED: {
    suggestion: 'On an empty stomach only when the product label or your clinician says so — food may improve tolerance.',
    required: 'uncertain',
    anchor: 'REVIEW',
    confidence: 'low',
  },
  TIMING_REVIEW: {
    suggestion: 'Check the product instructions or ask a clinician/pharmacist — no automatic timing applies.',
    required: 'uncertain',
    anchor: 'REVIEW',
    confidence: 'none',
  },
  FOLLOW_LABEL: {
    suggestion: 'Follow the verified product label — no generic timing rule applies to this item.',
    required: 'uncertain',
    anchor: 'LABEL',
    confidence: 'none',
  },
  WITH_BREAKFAST_OPTIONAL: {
    suggestion: 'With breakfast if convenient, or any other meal.',
    required: 'optional',
    anchor: 'BREAKFAST',
    confidence: 'moderate',
  },
  WITH_DINNER_OPTIONAL: {
    suggestion: 'With your evening meal if convenient — not required.',
    required: 'optional',
    anchor: 'DINNER',
    confidence: 'moderate',
  },
};

// Anchors that map to schedule timingRelation values.
const ANCHOR_TO_RELATION = {
  MEAL: 'WITH_MEAL',
  BREAKFAST: 'WITH_BREAKFAST',
  DINNER: 'WITH_DINNER',
  PRE_WORKOUT: 'AFTER_WORKOUT', // user-chosen; scheduling anchor is the workout event
  POST_WORKOUT: 'AFTER_WORKOUT',
  BEDTIME: 'BEFORE_BED',
  ANY: 'ANY_TIME',
  REVIEW: 'CUSTOM',
  LABEL: 'CUSTOM',
};

/**
 * Build the timing guidance payload for a supplement/ingredient row.
 * Accepts either an education record's fields or raw dataset fields.
 */
function guidanceFor({ timingCode, timingStrength, relativeAnchor, evidenceClass, productLabelRequired }) {
  const code = timingCode || 'ANY_TIME';
  const entry = TIMING_COPY[code] || TIMING_COPY.ANY_TIME;
  const labelDependent = timingStrength === 'LABEL_DEPENDENT' || code === 'FOLLOW_LABEL' || code === 'TIMING_REVIEW';

  return {
    timingCode: code,
    category: entry.anchor,
    suggestion: entry.suggestion,
    required: labelDependent ? 'uncertain' : entry.required,
    confidence: labelDependent ? 'none' : entry.confidence,
    scheduleRelation: ANCHOR_TO_RELATION[entry.anchor] || 'ANY_TIME',
    relativeAnchor: relativeAnchor || 'USER_CHOICE',
    autoScheduleAllowed: relativeAnchor !== 'NO_AUTO_SCHEDULE' && !labelDependent,
    needsClarification: labelDependent || entry.anchor === 'REVIEW',
    labelExceptions: productLabelRequired ? 'Check your product label — serving size and timing can differ by formulation.' : null,
    rationale: null, // filled by caller from education.timingRationale
    userConfirmationRequired: true, // the app never schedules without the user choosing
    evidenceClass: evidenceClass || null,
  };
}

module.exports = { guidanceFor, TIMING_COPY, ANCHOR_TO_RELATION };
