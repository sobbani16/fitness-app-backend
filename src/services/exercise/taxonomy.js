// Exercise movement-family taxonomy — pc-HUM-101 / exercise-intelligence-platform §4.
// Deterministic rule-based classifier derived from existing catalog fields
// (category, mechanic, force, muscles, equipment, name). Every classification
// carries the rule id that produced it so a wrong rule can be audited without
// guessing. Exercises that no rule fits are honestly `unclassified` — the
// program forbids forcing an inaccurate family.
//
// Muscle slugs match the real catalog vocabulary (pectoralis-major,
// biceps-brachii, …) — verified against the dev catalog 2026-11-26.
// Equipment is orthogonal: it rides alongside the family, never duplicates it.

const MUSCLE_GROUPS = {
  biceps: ['biceps-brachii', 'brachialis', 'brachioradialis'],
  triceps: ['triceps-brachii'],
  chest: ['pectoralis-major'],
  shoulders: ['deltoids'],
  back: ['latissimus-dorsi', 'trapezius', 'erector-spinae'],
  abs: ['rectus-abdominis'],
  calves: ['gastrocnemius', 'soleus'],
  forearms: ['forearm-flexors', 'forearm-extensors'],
};

function muscleSet(ex) {
  return new Set((ex.muscles || []).map((m) => String(m.muscle).toLowerCase()));
}
function hasAny(set, keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  return list.some((k) => (MUSCLE_GROUPS[k] || [k]).some((slug) => set.has(slug)));
}

const STRENGTH_LIKE = new Set(['strength', 'powerlifting', 'strongman']);
const strengthish = (c) => STRENGTH_LIKE.has(c.category);

// Ordered rule table — first match wins. Each rule: test(ex, ctx) -> partial or null.
const RULES = [
  // --- Static / mobility families ---
  { id: 'stretch-static', family: 'static_stretching', test: (ex, c) => c.category === 'stretching' && c.force === 'static' ? { subtype: 'static_stretch' } : null },
  { id: 'stretch-dynamic', family: 'dynamic_stretching', test: (ex, c) => c.category === 'stretching' ? { subtype: 'dynamic_or_pnf' } : null },

  // --- Functional families ---
  { id: 'cardio-walk-run', family: 'locomotion', test: (ex, c) => c.category === 'cardio' && /walk|run|jog|treadmill|stair|stepmill/.test(c.name) ? { subtype: /walk/.test(c.name) ? 'walking' : 'running' } : null },
  { id: 'cardio-cycling', family: 'locomotion', test: (ex, c) => c.category === 'cardio' && /cycl|bike|bicycl|stationary/.test(c.name) ? { subtype: 'cycling' } : null },
  { id: 'cardio-erg', family: 'locomotion', test: (ex, c) => c.category === 'cardio' && /row(ing)?\b|elliptical|skate|ski/.test(c.name) ? { subtype: 'ergometer' } : null },
  { id: 'cardio-general', family: 'locomotion', test: (ex, c) => c.category === 'cardio' ? { subtype: 'cardio_general' } : null },
  { id: 'plyo-jump', family: 'jumping_landing', test: (ex, c) => c.category === 'plyometrics' ? { subtype: /land|depth/.test(c.name) ? 'landing' : 'jumping' } : null },
  { id: 'olympic', family: 'olympic_lifting', test: (ex, c) => c.category === 'olympic weightlifting' || /snatch|clean and jerk|power clean|hang clean|muscle snatch/.test(c.name) && strengthish(c) ? { subtype: /snatch/.test(c.name) ? 'snatch' : /clean|jerk/.test(c.name) ? 'clean_jerk' : 'olympic_accessory' } : null },
  { id: 'strongman-carry', family: 'carrying', test: (ex, c) => strengthish(c) && /carry|walk.*(barbell|dumbbell|kettlebell|weight)|drag|sled|yoke|farmer|suitcase/.test(c.name) ? { subtype: 'loaded_carry' } : null },
  { id: 'strongman-explosive', family: 'explosive_movements', test: (ex, c) => c.category === 'strongman' ? { subtype: 'strongman_event' } : null },
  { id: 'kb-ballistic', family: 'kettlebell_movements', test: (ex, c) => /swing|snatch/.test(c.name) && c.equipment === 'kettlebells' && strengthish(c) ? { subtype: 'ballistic' } : null },

  // --- Lower-body strength families ---
  { id: 'squat-pattern', family: 'squat', test: (ex, c) => /squat/.test(c.name) && !/split|lunge/.test(c.name) && strengthish(c) ? { subtype: /front/.test(c.name) ? 'front_squat' : /overhead/.test(c.name) ? 'overhead_squat' : /hack|machine|smith/.test(c.name) ? 'machine_squat' : /zombie|zercher/.test(c.name) ? 'zercher_squat' : 'back_or_bodyweight_squat' } : null },
  { id: 'split-squat-lunge', family: 'lunge', test: (ex, c) => /lunge|split squat|bulgarian/.test(c.name) && strengthish(c) ? { subtype: /reverse/.test(c.name) ? 'reverse_lunge' : /walking/.test(c.name) ? 'walking_lunge' : /bulgarian|split squat/.test(c.name) ? 'split_squat' : 'lunge' } : null },
  { id: 'step-up', family: 'step_up', test: (ex, c) => /step[- ]?up|step up/.test(c.name) && strengthish(c) ? { subtype: 'step_up' } : null },
  { id: 'hip-hinge', family: 'hip_hinge', test: (ex, c) => /deadlift|romanian|stiff[- ]leg|good ?morning|pull through|hip thrust|glute bridge/.test(c.name) && strengthish(c) ? { subtype: /deadlift/.test(c.name) ? 'deadlift' : /hip thrust|glute bridge/.test(c.name) ? 'hip_extension_bridge' : 'hinge_accessory' } : null },
  { id: 'leg-press', family: 'leg_press', test: (ex, c) => /leg press|hack press|sled press/.test(c.name) ? { subtype: 'machine_press' } : null },
  { id: 'knee-extension', family: 'knee_extension', test: (ex, c) => /leg extension|knee extension/.test(c.name) ? { subtype: 'machine_isolation' } : null },
  { id: 'knee-flexion', family: 'knee_flexion', test: (ex, c) => /leg curl|hamstring curl|glute[- ]ham|nordic|inverse leg curl/.test(c.name) ? { subtype: 'curl' } : null },
  { id: 'hip-abduction', family: 'hip_abduction', test: (ex, c) => /abductor|abduction/.test(c.name) && strengthish(c) ? { subtype: 'hip_abduction' } : null },
  { id: 'hip-adduction', family: 'hip_adduction', test: (ex, c) => /adductor|adduction/.test(c.name) && strengthish(c) ? { subtype: 'hip_adduction' } : null },
  { id: 'calf-plantarflexion', family: 'ankle_plantarflexion', test: (ex, c) => (hasAny(c.muscles, 'calves') && /raise|press/.test(c.name)) || /calf/.test(c.name) && strengthish(c) ? { subtype: 'calf_raise' } : null },
  { id: 'glute-isolation', family: 'hip_extension', test: (ex, c) => /glute kickback|donkey kick|fire hydrant|bird dog/.test(c.name) ? { subtype: 'glute_isolation' } : null },

  // --- Upper-body push/pull families ---
  { id: 'horizontal-push', family: 'horizontal_push', test: (ex, c) => strengthish(c) && c.force === 'push' && (hasAny(c.muscles, 'chest') || /bench press|chest press|push[- ]?up|pushup|floor press|board press/.test(c.name)) && !/overhead|shoulder press|military|arnold|incline.*shoulder/.test(c.name) ? { subtype: /flye?|crossover|pec deck/.test(c.name) ? 'flye_isolation' : /press/.test(c.name) ? 'horizontal_press' : 'horizontal_push' } : null },
  { id: 'flye-family', family: 'horizontal_push', test: (ex, c) => strengthish(c) && /flye?\b|chest fly|pec deck|crossover|around the worlds/.test(c.name) && hasAny(c.muscles, 'chest') ? { subtype: 'flye_isolation' } : null },
  { id: 'vertical-push', family: 'vertical_push', test: (ex, c) => strengthish(c) && c.force === 'push' && (/overhead|shoulder press|military|arnold|push press|behind.*neck|shoulder raise|deltoid raise/.test(c.name) || (hasAny(c.muscles, 'shoulders') && /press/.test(c.name))) ? { subtype: 'overhead_press' } : null },
  { id: 'dip-push', family: 'vertical_push', test: (ex, c) => /dip/.test(c.name) && strengthish(c) && c.force === 'push' ? { subtype: 'dip' } : null },
  { id: 'vertical-pull', family: 'vertical_pull', test: (ex, c) => strengthish(c) && /pull[- ]?up|chin[- ]?up|chin up|lat pull|pulldown|pull down|muscle[- ]?up/.test(c.name) ? { subtype: /pull[- ]?up|chin|muscle[- ]?up/.test(c.name) ? 'bodyweight_vertical_pull' : 'pulldown' } : null },
  { id: 'horizontal-pull', family: 'horizontal_pull', test: (ex, c) => strengthish(c) && c.force === 'pull' && /row\b|rows\b|rowing|cable row|bent.over|seated row|t-bar|pendlay/.test(c.name) ? { subtype: 'row' } : null },
  { id: 'pullover-pull', family: 'horizontal_pull', test: (ex, c) => strengthish(c) && /pullover|straight[- ]arm pull/.test(c.name) ? { subtype: 'pullover' } : null },
  { id: 'shrug-upper-back', family: 'scapular_movement', test: (ex, c) => strengthish(c) && /shrug|upright row|reverse fly|rear delt|face pull|band pull apart|scapular|scap\b|power shrug/.test(c.name) ? { subtype: /shrug/.test(c.name) ? 'shrug' : /upright row/.test(c.name) ? 'upright_row' : 'scapular_retraction' } : null },
  { id: 'elbow-flexion', family: 'elbow_flexion', test: (ex, c) => strengthish(c) && /curl/.test(c.name) && (hasAny(c.muscles, 'biceps') || !/leg|wrist|hamstring/.test(c.name)) ? { subtype: /hammer/.test(c.name) ? 'hammer_curl' : /preacher/.test(c.name) ? 'preacher_curl' : /concentration/.test(c.name) ? 'concentration_curl' : 'curl' } : null },
  { id: 'elbow-extension', family: 'elbow_extension', test: (ex, c) => strengthish(c) && (/skullcrusher|skull crusher|pushdown|push down|tricep.*extension|overhead.*extension|french press|close grip|bench dip|dips.*tricep/.test(c.name) || (/tricep/.test(c.name) && c.force === 'push') || (hasAny(c.muscles, 'triceps') && /extension|press down/.test(c.name))) ? { subtype: /pushdown|push down/.test(c.name) ? 'cable_pushdown' : /overhead/.test(c.name) ? 'overhead_extension' : 'elbow_extension' } : null },
  { id: 'shoulder-abduction', family: 'shoulder_abduction', test: (ex, c) => /lateral raise|side raise|side lateral/.test(c.name) ? { subtype: 'lateral_raise' } : null },
  { id: 'shoulder-flexion', family: 'shoulder_flexion', test: (ex, c) => /front raise|front deltoid/.test(c.name) ? { subtype: 'front_raise' } : null },
  { id: 'shoulder-rotation', family: 'shoulder_rotation', test: (ex, c) => /rotator|external rotation|internal rotation|cuban|windmill/.test(c.name) ? { subtype: 'rotation' } : null },
  { id: 'wrist-forearm', family: 'wrist_flexion', test: (ex, c) => strengthish(c) && (hasAny(c.muscles, 'forearms') || /wrist|grip|forearm/.test(c.name)) && /wrist|grip|forearm|finger/.test(c.name) ? { subtype: /wrist curl/.test(c.name) ? 'wrist_curl' : 'grip_forearm' } : null },

  // --- Core families ---
  { id: 'core-rotation', family: 'trunk_rotation', test: (ex, c) => /twist|rotation|woodchop|pallof|windshield wiper/.test(c.name) && (hasAny(c.muscles, 'abs') || strengthish(c)) ? { subtype: /pallof/.test(c.name) ? 'anti_rotation' : 'rotation' } : null },
  { id: 'core-flexion', family: 'trunk_flexion', test: (ex, c) => /crunch|sit[- ]?up|situp|knee raise|leg raise|v[- ]?up|jackknife|ab roller|rollout/.test(c.name) ? { subtype: /leg raise|knee raise/.test(c.name) ? 'hip_flexion_core' : /ab roller|rollout/.test(c.name) ? 'rollout' : 'spinal_flexion' } : null },
  { id: 'core-hip-raise', family: 'trunk_flexion', test: (ex, c) => /hip raise|pelvic tilt|reverse crunch/.test(c.name) && strengthish(c) ? { subtype: 'hip_flexion_core' } : null },
  { id: 'core-extension', family: 'trunk_extension', test: (ex, c) => /hyperextension|back extension|superman/.test(c.name) && strengthish(c) ? { subtype: 'spinal_extension' } : null },
  { id: 'core-antiextension', family: 'anti_extension', test: (ex, c) => /plank|ab wheel|dead bug|hollow hold|hollow body/.test(c.name) ? { subtype: /plank/.test(c.name) ? 'plank_variation' : 'anti_extension_dynamic' } : null },
  { id: 'core-lateral', family: 'lateral_flexion', test: (ex, c) => /side bend|oblique|side plank/.test(c.name) ? { subtype: /side plank/.test(c.name) ? 'anti_lateral_flexion' : 'lateral_flexion' } : null },

  { id: 'isometric-hold', family: 'isometric_hold', test: (ex, c) => c.force === 'static' && strengthish(c) ? { subtype: /plank/.test(c.name) ? 'plank_variation' : 'static_hold' } : null },

  // --- Balance ---
  { id: 'balance', family: 'single_leg_balance', test: (ex, c) => /balance board|stability ball balance|single leg balance|bosu/.test(c.name) ? { subtype: 'balance_training' } : null },
];

function ctx(ex) {
  return {
    muscles: muscleSet(ex),
    name: String(ex.name || '').toLowerCase(),
    equipment: String(ex.equipment || '').toLowerCase(),
    category: String(ex.category || '').toLowerCase(),
    force: String(ex.force || '').toLowerCase(),
    mechanic: String(ex.mechanic || '').toLowerCase(),
  };
}

const UNILATERAL_RE = /\b(one[- ]arm|single[- ]arm|one[- ]leg|single[- ]leg|one leg|single leg|unilateral|alternating|split[- ]|pistol|bulgarian|lunge|step[- ]?up)\b/i;
const BILATERAL_OVERRIDE_RE = /\bbarbell(?!.*alternating)/i;

/**
 * Classify one exercise row into the movement taxonomy.
 * Every hit carries the rule id that produced it; unclassified is explicit.
 */
function classifyExercise(ex) {
  const c = ctx(ex);
  const compound = c.mechanic === 'compound' ? true : c.mechanic === 'isolation' ? false : null;
  for (const rule of RULES) {
    const hit = rule.test(ex, c);
    if (hit) {
      let unilateral = UNILATERAL_RE.test(c.name) ? true : null;
      if (unilateral && BILATERAL_OVERRIDE_RE.test(c.name) && !/alternating/.test(c.name)) unilateral = false;
      return {
        family: rule.family,
        subtype: hit.subtype || null,
        variation: { unilateral, static: c.force === 'static', compound },
        ruleId: rule.id,
        classified: true,
      };
    }
  }
  return { family: null, subtype: null, variation: { unilateral: null, static: c.force === 'static', compound }, ruleId: null, classified: false };
}

const FAMILIES = [...new Set(RULES.map((r) => r.family))];

module.exports = { classifyExercise, FAMILIES, RULES };
