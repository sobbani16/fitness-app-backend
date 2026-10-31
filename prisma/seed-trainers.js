// Seeds 10 synthetic trainer profiles (with RBAC role, certifications) and
// 3 demo clients (active trainer relations, v0-legacy consents, ~14 days of
// plausible activity data) so dashboards have something to render.
//
// Every write is an upsert on a natural key (or findFirst+create for tables
// without one), so the script is fully idempotent and safe to re-run.
// Seed rows are recognizable: emails end in @humai-seed.example, display
// names are "Sample Trainer N", activity rows carry source 'seed-trainers'.
//
// Run with: node prisma/seed-trainers.js
// Optional env: SEED_TRAINER_PASSWORD (default 'Trainer-Seed-Passw0rd!')

const { getPrisma } = require('../src/lib/prisma');
const { hashPassword } = require('../src/services/authService');
const { CONSENT_CATEGORIES } = require('../src/services/trainerAccess');

const SEED_PASSWORD = process.env.SEED_TRAINER_PASSWORD || 'Trainer-Seed-Passw0rd!';
const SEED_SOURCE = 'seed-trainers';
const DAYS = 14;

const TRAINERS = [
  { n: 1, tier: 'standard', specialties: ['strength_training', 'weight_loss'], location: 'Austin, TX', country: 'US', timeZone: 'America/Chicago', languages: ['en'], coachingMode: 'online', yearsExperience: 3, hourlyRate: 45 },
  { n: 2, tier: 'standard', specialties: ['yoga', 'flexibility'], location: 'Portland, OR', country: 'US', timeZone: 'America/Los_Angeles', languages: ['en', 'es'], coachingMode: 'both', yearsExperience: 4, hourlyRate: 50 },
  { n: 3, tier: 'standard', specialties: ['hiit', 'cardio'], location: 'Denver, CO', country: 'US', timeZone: 'America/Denver', languages: ['en'], coachingMode: 'in_person', yearsExperience: 2, hourlyRate: 40 },
  { n: 4, tier: 'standard', specialties: ['running', 'cycling'], location: 'London', country: 'UK', timeZone: 'Europe/London', languages: ['en'], coachingMode: 'online', yearsExperience: 5, hourlyRate: 55 },
  { n: 5, tier: 'pro', specialties: ['strength_training', 'muscle_gain'], location: 'Toronto', country: 'CA', timeZone: 'America/Toronto', languages: ['en', 'fr'], coachingMode: 'both', yearsExperience: 8, hourlyRate: 80 },
  { n: 6, tier: 'pro', specialties: ['nutrition_coaching', 'weight_loss'], location: 'Berlin', country: 'DE', timeZone: 'Europe/Berlin', languages: ['de', 'en'], coachingMode: 'online', yearsExperience: 7, hourlyRate: 75 },
  { n: 7, tier: 'pro', specialties: ['crossfit', 'hiit'], location: 'Sydney', country: 'AU', timeZone: 'Australia/Sydney', languages: ['en'], coachingMode: 'in_person', yearsExperience: 9, hourlyRate: 90 },
  { n: 8, tier: 'pro', specialties: ['pilates', 'rehab_recovery'], location: 'New York, NY', country: 'US', timeZone: 'America/New_York', languages: ['en', 'pt'], coachingMode: 'both', yearsExperience: 6, hourlyRate: 85 },
  { n: 9, tier: 'elite', specialties: ['strength_training', 'nutrition_coaching', 'boxing'], location: 'Los Angeles, CA', country: 'US', timeZone: 'America/Los_Angeles', languages: ['en'], coachingMode: 'both', yearsExperience: 14, hourlyRate: 150 },
  { n: 10, tier: 'elite', specialties: ['swimming', 'running', 'cardio'], location: 'Amsterdam', country: 'NL', timeZone: 'Europe/Amsterdam', languages: ['nl', 'en', 'de'], coachingMode: 'online', yearsExperience: 12, hourlyRate: 140 },
];

// 2-3 certifications per trainer: the first is 'verified', rest unverified /
// pending_review. Names are fictional-but-plausible.
function certificationsFor(t) {
  const certs = [
    { name: `SampleCert Level ${t.n} Coaching Certificate`, issuingOrganization: 'Sample Certification Board', verificationStatus: 'verified', verifiedAt: new Date('2023-01-15T00:00:00Z'), credentialId: `SCB-${1000 + t.n}` },
    { name: 'Fictional Strength & Conditioning Diploma', issuingOrganization: 'Example Strength Institute', verificationStatus: 'pending_review', credentialId: `ESI-${2000 + t.n}` },
  ];
  if (t.tier !== 'standard') {
    certs.push({ name: 'Mock Advanced Periodization Cert', issuingOrganization: 'Demo Coaching Academy', verificationStatus: 'unverified' });
  }
  return certs;
}

function upsertUser(prisma, { email, passwordHash, firstName, lastName }) {
  return prisma.user.upsert({
    where: { email },
    update: { passwordHash, emailVerifiedAt: new Date(), firstName, lastName },
    create: { email, passwordHash, emailVerifiedAt: new Date(), firstName, lastName },
  });
}

async function seedTrainers(prisma, passwordHash, trainerRoleId) {
  console.log('Seeding trainer users + profiles...');
  const profiles = [];
  for (const t of TRAINERS) {
    const user = await upsertUser(prisma, {
      email: `trainer${t.n}@humai-seed.example`,
      passwordHash,
      firstName: 'Sample',
      lastName: `Trainer ${t.n}`,
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: trainerRoleId } },
      update: { active: true },
      create: { userId: user.id, roleId: trainerRoleId, active: true },
    });
    const profileData = {
      bio: `Sample Trainer ${t.n} — fictional seed profile for development. Focus: ${t.specialties.join(', ')}.`,
      specialties: t.specialties,
      yearsExperience: t.yearsExperience,
      hourlyRate: t.hourlyRate,
      tier: t.tier,
      location: t.location,
      country: t.country,
      timeZone: t.timeZone,
      languages: t.languages,
      coachingMode: t.coachingMode,
      displayName: `Sample Trainer ${t.n}`,
      isDiscoverable: true,
      verified: true,
      active: true,
      applicationStatus: 'approved',
      approvedAt: new Date('2023-02-01T00:00:00Z'),
      maxClients: 10,
      rating: Math.round((4 + (t.n % 10) / 10) * 100) / 100,
      ratingCount: 5 + t.n * 3,
      certifications: certificationsFor(t).map((c) => c.name), // legacy field kept in sync
    };
    const profile = await prisma.trainerProfile.upsert({
      where: { userId: user.id },
      update: profileData,
      create: { userId: user.id, ...profileData },
    });
    for (const cert of certificationsFor(t)) {
      const existing = await prisma.trainerCertification.findFirst({
        where: { trainerId: profile.id, name: cert.name },
        select: { id: true },
      });
      if (!existing) {
        await prisma.trainerCertification.create({ data: { trainerId: profile.id, ...cert } });
      }
    }
    profiles.push(profile);
  }
  console.log(`  ✓ ${profiles.length} trainer users + profiles + certifications`);
  return profiles;
}

async function seedClients(prisma, passwordHash) {
  console.log('Seeding client users...');
  const clients = [];
  for (let n = 1; n <= 3; n++) {
    clients.push(await upsertUser(prisma, {
      email: `client${n}@humai-seed.example`,
      passwordHash,
      firstName: 'Sample',
      lastName: `Client ${n}`,
    }));
  }
  console.log(`  ✓ ${clients.length} client users`);
  return clients;
}

async function seedRelationsAndConsents(prisma, profiles, clients, startedAt) {
  console.log('Seeding trainer-client relations + v0-legacy consents...');
  for (let i = 0; i < clients.length; i++) {
    const relation = await prisma.trainerClient.upsert({
      where: { trainerId_clientId: { trainerId: profiles[i].id, clientId: clients[i].id } },
      update: { status: 'active' },
      create: {
        trainerId: profiles[i].id,
        clientId: clients[i].id,
        status: 'active',
        requestedBy: 'client',
        assignedAt: startedAt,
        startedAt,
      },
    });
    for (const category of CONSENT_CATEGORIES) {
      await prisma.trainerClientConsent.upsert({
        where: { relationId_category: { relationId: relation.id, category } },
        update: { status: 'granted', policyVersion: 'v0-legacy', grantedAt: startedAt, revokedAt: null },
        create: { relationId: relation.id, category, status: 'granted', policyVersion: 'v0-legacy', grantedAt: startedAt },
      });
    }
  }
  console.log(`  ✓ ${clients.length} active relations, ${CONSENT_CATEGORIES.length} consent rows each`);
}

// Deterministic pseudo-random in [0, 1) — stable across runs so re-seeding
// produces identical rows and never duplicates.
function det(clientIdx, dayIdx, salt) {
  return ((clientIdx + 1) * 37 + dayIdx * 73 + salt * 131) % 1000 / 1000;
}

/** findFirst+create on a natural key for tables without a unique constraint. */
async function ensureRow(prisma, model, where, data) {
  const existing = await prisma[model].findFirst({ where, select: { id: true } });
  if (existing) return existing;
  return prisma[model].create({ data });
}

async function seedActivity(prisma, client, clientIdx, now) {
  let rows = 0;
  for (let d = 0; d < DAYS; d++) {
    // d=0 is yesterday so every timestamp below is comfortably in the past.
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d - 1));
    const ext = (kind) => `${SEED_SOURCE}:client${clientIdx + 1}:${kind}:${dayStart.toISOString().slice(0, 10)}`;

    // DailySteps — every day
    await ensureRow(prisma, 'dailySteps', { userId: client.id, externalId: ext('steps') }, {
      userId: client.id, date: dayStart, steps: Math.round(4200 + det(clientIdx, d, 1) * 8600),
      distanceKm: Math.round((3 + det(clientIdx, d, 2) * 6) * 100) / 100, source: SEED_SOURCE, externalId: ext('steps'),
    });
    rows++;

    // SleepLog — every night (22:30-ish -> 06:30-ish)
    const sleepStart = new Date(dayStart.getTime() - (2 * 60 + Math.round(det(clientIdx, d, 3) * 60)) * 60000);
    const hours = Math.round((6.4 + det(clientIdx, d, 4) * 2.2) * 10) / 10;
    await ensureRow(prisma, 'sleepLog', { userId: client.id, externalId: ext('sleep') }, {
      userId: client.id, sleepStart, sleepEnd: new Date(sleepStart.getTime() + hours * 3600000),
      hoursSlept: hours, sleepScore: Math.round(66 + det(clientIdx, d, 5) * 28), source: SEED_SOURCE, externalId: ext('sleep'),
    });
    rows++;

    // WeightEntry — every 2 days, gentle downward trend
    if (d % 2 === 0) {
      const recordedAt = new Date(dayStart.getTime() + 7 * 3600000);
      const weightKg = Math.round(((82 - clientIdx * 4) - d * 0.07 + det(clientIdx, d, 6) * 0.4) * 10) / 10;
      await ensureRow(prisma, 'weightEntry', { userId: client.id, recordedAt }, {
        userId: client.id, weightKg, recordedAt,
      });
      rows++;
    }

    // FoodLog — 2 meals/day from a rotating menu
    const meals = [
      { foodName: 'Oatmeal with berries', mealType: 'breakfast', quantityG: 320, calories: 380, proteinG: 12, carbsG: 62, fatG: 8, fiberG: 9 },
      { foodName: 'Grilled chicken salad', mealType: 'lunch', quantityG: 350, calories: 450, proteinG: 38, carbsG: 18, fatG: 22, fiberG: 6 },
      { foodName: 'Salmon with rice', mealType: 'dinner', quantityG: 400, calories: 620, proteinG: 42, carbsG: 55, fatG: 24, fiberG: 4 },
    ];
    for (const m of [meals[d % 3], meals[(d + 1) % 3]]) {
      const loggedAt = new Date(dayStart.getTime() + (m.mealType === 'breakfast' ? 8 : m.mealType === 'lunch' ? 13 : 19) * 3600000);
      await ensureRow(prisma, 'foodLog', { userId: client.id, loggedAt, foodName: m.foodName }, {
        userId: client.id, loggedAt, ...m,
      });
      rows++;
    }

    // WorkoutSession — every other day, 3 sets each
    if (d % 2 === 1) {
      const types = ['strength', 'run', 'hiit', 'yoga'];
      const workoutType = types[(d + clientIdx) % types.length];
      const startedAt = new Date(dayStart.getTime() + 17 * 3600000);
      const session = await ensureRow(prisma, 'workoutSession', { userId: client.id, externalId: ext('workout') }, {
        userId: client.id, workoutType, startedAt, endedAt: new Date(startedAt.getTime() + 45 * 60000),
        finishedAt: new Date(startedAt.getTime() + 45 * 60000), durationMinutes: 45,
        caloriesBurned: Math.round(220 + det(clientIdx, d, 7) * 260), source: SEED_SOURCE, externalId: ext('workout'),
      });
      rows++;
      const setNames = { strength: 'Back Squat', run: 'Intervals', hiit: 'Burpees', yoga: 'Sun Salutation' };
      for (let s = 1; s <= 3; s++) {
        await ensureRow(prisma, 'exerciseSet', { workoutSessionId: session.id, setNumber: s, exerciseName: setNames[workoutType] }, {
          workoutSessionId: session.id, exerciseName: setNames[workoutType],
          reps: 8 + ((d + s) % 5), weightLbs: workoutType === 'strength' ? 95 + s * 10 : null, setNumber: s,
        });
        rows++;
      }
    }
  }
  return rows;
}

async function main() {
  const prisma = getPrisma();
  const trainerRole = await prisma.role.findUnique({ where: { name: 'TRAINER' } });
  if (!trainerRole) throw new Error('TRAINER role not found — run `node prisma/seed-rbac.js` first.');

  // scrypt-hashed once (same format as src/services/authService.hashPassword:
  // `${saltHex}:${scryptHex}` with a 16-byte salt and 64-byte key).
  const passwordHash = await hashPassword(SEED_PASSWORD);
  const startedAt = new Date(Date.now() - DAYS * 86400000);

  await prisma.$transaction(async (tx) => {
    const profiles = await seedTrainers(tx, passwordHash, trainerRole.id);
    const clients = await seedClients(tx, passwordHash);
    await seedRelationsAndConsents(tx, profiles, clients, startedAt);

    console.log('Seeding 14 days of client activity data...');
    const now = new Date();
    for (let i = 0; i < clients.length; i++) {
      const rows = await seedActivity(tx, clients[i], i, now);
      console.log(`  ✓ client${i + 1}@humai-seed.example -> ${rows} activity rows ensured`);
    }
  }, { timeout: 120000 });

  console.log('\n✅ Trainer seed complete! (10 trainers, 3 clients — all fictional)');
}

main()
  .then(async () => { await getPrisma().$disconnect(); })
  .catch(async (err) => { console.error(err); await getPrisma().$disconnect(); process.exit(1); });
