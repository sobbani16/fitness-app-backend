// Seeds the membership module catalog (idempotent). Packages stay inactive —
// nothing bills or gates until explicitly activated in Super Admin.
const { getPrisma } = require('../src/lib/prisma');

const MODULES = [
  ['FREE_CORE', 'Free essentials', 'Account, profile, core logging basics'],
  ['NUTRITION', 'Nutrition', 'Food logging, meal history, label intelligence, nutrition reports'],
  ['WORKOUTS', 'Workouts', 'Workout plans, exercise tracking, training progress'],
  ['EXERCISE_LIBRARY', 'Exercise library', 'Full exercise database + demos'],
  ['ADVANCED_VIDEO_GUIDANCE', 'Advanced video guidance', 'Pose compare + guided video'],
  ['LEO_AI', 'Leo AI', 'Advanced AI coaching + higher usage allowances'],
  ['ADVANCED_ANALYTICS', 'Advanced analytics', 'Deep progress analysis + reports'],
  ['TRAINER_COACHING', 'Trainer coaching', 'Connect with a Humai trainer'],
  ['LIVE_SESSIONS', 'Live sessions', 'Video consultations'],
  ['KNOWLEDGE_PREMIUM', 'Knowledge premium', 'Extended academy content, if enabled'],
];

const PACKAGES = [
  ['free', 'Free', ['FREE_CORE'], 0, true],
  ['nutrition', 'Nutrition only', ['FREE_CORE', 'NUTRITION'], 0, false],
  ['workout', 'Workout only', ['FREE_CORE', 'WORKOUTS', 'EXERCISE_LIBRARY'], 0, false],
  ['nutrition_workout', 'Nutrition + Workout', ['FREE_CORE', 'NUTRITION', 'WORKOUTS', 'EXERCISE_LIBRARY'], 0, false],
  ['full', 'Full membership', ['FREE_CORE', 'NUTRITION', 'WORKOUTS', 'EXERCISE_LIBRARY', 'LEO_AI', 'ADVANCED_ANALYTICS', 'TRAINER_COACHING', 'LIVE_SESSIONS'], 0, false],
  ['ai_addon', 'Leo AI add-on', ['LEO_AI'], 0, false],
];

async function main() {
  const prisma = getPrisma();
  for (const [key, name, description] of MODULES)
    await prisma.membershipModule.upsert({ where: { key }, update: { name, description }, create: { key, name, description } });
  for (const [key, name, modules, trialDays, active] of PACKAGES)
    await prisma.membershipPackage.upsert({ where: { key }, update: { name, modules, trialDays }, create: { key, name, modules, trialDays, active } });
  console.log(`Seeded ${MODULES.length} modules, ${PACKAGES.length} packages (${PACKAGES.filter(p => p[4]).length} active).`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
