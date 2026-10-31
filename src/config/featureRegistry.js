/**
 * Centralized feature-flag registry — the single source of truth for flag keys,
 * classes, dependencies, defaults, and AI kill-switch grouping.
 *
 * Key format: snake_case (matches PostHog flag keys). `clientKey` (camelCase) is
 * what GET /config/features emits for mobile consumers — keep in sync with
 * src/config/featureKeys.ts in fitness-app-mobile.
 *
 * class:
 *   core       - manual logging and other never-flagged-down core paths
 *   ai         - invokes an external AI provider; member of the kill group
 *   mixed      - feature mixes AI and deterministic/manual paths; only the AI
 *                sub-path is killed (see `aiPaths`)
 *   server     - deterministic backend feature
 *   onDevice   - fully on-device; flags control UI only, backend not involved
 *   control    - control-plane flag (kill switch itself)
 *
 * group 'ai' => forced OFF when ai_emergency_shutdown or AI_EMERGENCY_SHUTDOWN
 * is active. Manual logging flags are intentionally NOT in the group.
 *
 * default       - resolved value when no env override or provider flag exists.
 * failOpen      - on provider error, resolve to `default` and keep serving
 *                 (core/manual) vs. fail closed for costly/AI features
 *                 (their `default` is already false).
 * dependsOn     - other flag keys that must also resolve true.
 * environments  - if set, flag resolves false outside these NODE_ENV values.
 * envOverride   - derived env var name (FF_<KEY>) that beats the provider.
 * endpoints     - backend routes this flag must gate (documentation/enforcement).
 */

const FEATURES = {
  manual_food_logging: {
    clientKey: 'manualFoodLogging',
    class: 'core',
    group: 'manual',
    default: true,
    failOpen: true,
    endpoints: ['/food-logs', '/ingredients', '/summary', '/daily-stats', '/recipes'],
    description: 'Manual food entry, search, diary CRUD. Never in the AI kill group.',
  },
  manual_exercise_logging: {
    clientKey: 'manualExerciseLogging',
    class: 'core',
    group: 'manual',
    default: true,
    failOpen: true,
    endpoints: ['/exercises'],
    description: 'Manual exercise/workout entry. Never in the AI kill group.',
  },
  food_photo_scanning: {
    clientKey: 'foodPhotoScanning',
    class: 'ai',
    group: 'ai',
    default: false,
    failOpen: false,
    endpoints: ['POST /meals/detect', 'POST /meals/analyze'],
    description: 'Camera food scanning / AI estimation from photo or text.',
  },
  nutrition_label_scanning: {
    clientKey: 'nutritionLabelScanning',
    class: 'mixed',
    group: 'ai',
    aiPaths: ['POST /label-scanner/extract'],
    default: false,
    failOpen: false,
    endpoints: ['POST /label-scanner/extract'],
    description: 'Nutrition label OCR + AI extraction. On-device OCR, classify and save stay available; only AI extraction is killed.',
  },
  menu_scanning: {
    clientKey: 'menuScanning',
    class: 'mixed',
    group: 'ai',
    aiPaths: ['POST /menu-analysis'],
    default: false,
    failOpen: false,
    endpoints: ['POST /menu-analysis'],
    description: 'Restaurant menu scanning; deterministic OCR parse degrades, AI extraction is killed.',
  },
  ai_coach: {
    clientKey: 'aiCoach',
    class: 'ai',
    group: 'ai',
    default: false,
    failOpen: false,
    endpoints: ['POST /chat', 'GET /chat/status'],
    description: 'Leo AI coach chat.',
  },
  ai_food_recommendations: {
    clientKey: 'aiFoodRecommendations',
    class: 'ai',
    group: 'ai',
    default: false,
    failOpen: false,
    endpoints: [],
    description: 'Reserved for AI nutrition suggestions. Current /recommendations and food-intelligence endpoints are deterministic and not gated by this flag.',
  },
  ai_workout_recommendations: {
    clientKey: 'aiWorkoutRecommendations',
    class: 'ai',
    group: 'ai',
    default: false,
    failOpen: false,
    endpoints: ['POST /personal-plans/draft'],
    description: 'AI-generated personal workout plan drafts.',
  },
  voice_food_logging: {
    clientKey: 'voiceFoodLogging',
    class: 'ai',
    group: 'ai',
    dependsOn: ['manual_food_logging'],
    default: false,
    failOpen: false,
    endpoints: ['POST /voice/transcribe', 'POST /voice/interpret'],
    description: 'Voice-based food entry (mic + transcription + AI interpretation).',
  },
  voice_exercise_logging: {
    clientKey: 'voiceExerciseLogging',
    class: 'ai',
    group: 'ai',
    dependsOn: ['manual_exercise_logging'],
    default: false,
    failOpen: false,
    endpoints: ['POST /voice/transcribe', 'POST /voice/interpret'],
    description: 'Voice-based exercise entry. Shares /voice/* endpoints with voice_food_logging; gated at UI level.',
  },
  pose_detection: {
    clientKey: 'poseDetection',
    class: 'onDevice',
    group: 'manual',
    default: true,
    failOpen: true,
    endpoints: [],
    description: 'On-device pose/rep detection (MediaPipe). ML but not AI-provider; intentionally outside the kill group.',
  },
  weekly_meal_plans: {
    clientKey: 'weeklyMealPlans',
    class: 'mixed',
    group: 'manual',
    aiPaths: ['POST /weekly-plan/generate'],
    default: false,
    failOpen: false,
    endpoints: ['/weekly-plan'],
    description: 'Weekly meal planning. Router gated; /generate degrades to the deterministic USDA fallback when AI is off.',
  },
  weekly_plan_ai_generation: {
    clientKey: 'weeklyPlanAiGeneration',
    class: 'ai',
    group: 'ai',
    dependsOn: ['weekly_meal_plans'],
    default: false,
    failOpen: false,
    endpoints: ['POST /weekly-plan/generate (AI path only)'],
    description: 'The AI generation path inside /weekly-plan/generate. Off => deterministic fallback is used.',
  },
  apple_health_sync: {
    clientKey: 'appleHealthSync',
    class: 'server',
    group: 'manual',
    default: false,
    failOpen: false,
    endpoints: ['/health-data'],
    description: 'Apple Health / wearable energy sync.',
  },
  android_health_sync: {
    clientKey: 'androidHealthSync',
    class: 'server',
    group: 'manual',
    default: false,
    failOpen: false,
    endpoints: ['/health-data'],
    description: 'Android Health Connect / wearable energy sync.',
  },
  trainer_dashboard: {
    clientKey: 'trainerDashboard',
    class: 'server',
    group: 'manual',
    default: false,
    failOpen: false,
    endpoints: ['/trainers'],
    description: 'Trainer functionality. Flag gates in addition to existing RBAC role checks.',
  },
  smart_reminder_suggestions: {
    clientKey: 'smartReminderSuggestions',
    class: 'server',
    group: 'manual',
    default: true,
    failOpen: true,
    endpoints: ['/reminders/suggestions'],
    description: 'Server-side adaptive reminder suggestion generation. Core reminder scheduling stays ungated.',
  },
  supplements: {
    clientKey: 'supplements',
    class: 'server',
    group: 'manual',
    default: false,
    failOpen: false,
    endpoints: ['/supplements'],
    description: 'Supplement catalog + logging.',
  },
  video_search: {
    clientKey: 'videoSearch',
    class: 'server',
    group: 'manual',
    default: false,
    failOpen: false,
    endpoints: ['/videos'],
    description: 'YouTube exercise video search. Currently orphaned UI; kept flagged off pending removal decision.',
  },
  ai_emergency_shutdown: {
    clientKey: 'aiEmergencyShutdown',
    class: 'control',
    group: 'control',
    default: false,
    failOpen: false,
    endpoints: [],
    description: 'Global AI kill switch. When on, every group:ai flag resolves false regardless of targeting.',
  },
};

const KEYS = Object.keys(FEATURES);
const AI_GROUP_KEYS = KEYS.filter((k) => FEATURES[k].group === 'ai');
const envOverrideName = (key) => `FF_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;

module.exports = { FEATURES, KEYS, AI_GROUP_KEYS, envOverrideName };
