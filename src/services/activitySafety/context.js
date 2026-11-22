// Safety-context loader — assembles everything the engine needs from the DB.
// Missing sections degrade to empty/unknown, never to "clear". The
// inputsStamp lets persisted evaluations detect when any safety input
// changed (new injury, updated restriction) so caches never bypass them.

const { CONDITION_KEYS } = require('./constants');

const SYMPTOM_ACTIVE_HOURS = 72; // a symptom report stays "active" context for 72h unless resolved

async function loadSafetyContext(prisma, userId, { now = new Date(), preferences = {} } = {}) {
  const q = (fn, fb) => Promise.resolve().then(fn).catch(() => fb);
  const [user, profile, injuries, surgeries, restrictions, symptoms, conditions] = await Promise.all([
    q(() => prisma.user.findUnique({ where: { id: userId }, select: { dateOfBirth: true, activityLevel: true, goalType: true } }), null),
    q(() => prisma.userActivityProfile.findUnique({ where: { userId } }), null),
    q(() => prisma.userInjury.findMany({ where: { userId, status: { in: ['current', 'recovering'] } } }), []),
    q(() => prisma.userSurgery.findMany({ where: { userId, status: { in: ['recovering', 'long_term_restricted'] } } }), []),
    q(() => prisma.userActivityRestriction.findMany({ where: { userId, status: { in: ['active', 'expired'] } } }), []),
    q(() => prisma.userSymptomReport.findMany({
      where: { userId, status: 'active', reportedAt: { gte: new Date(now.getTime() - SYMPTOM_ACTIVE_HOURS * 3600000) } },
    }), []),
    q(() => prisma.userHealthCondition.findMany({ where: { userId, active: true }, include: { condition: { select: { name: true } } } }), []),
  ]);

  const conditionKeys = new Set();
  for (const uc of conditions) {
    const key = CONDITION_KEYS[(uc.condition?.name || '').toLowerCase().trim()];
    if (key) conditionKeys.add(key);
  }

  const ageYears = user?.dateOfBirth ? Math.floor((now - new Date(user.dateOfBirth)) / 31557600000) : null;
  const mobility = profile ? {
    walkingAbility: profile.walkingAbility ?? null,
    mobilityAids: profile.mobilityAids || [],
    wheelchairUser: profile.wheelchairUser === true,
    balanceLimitation: profile.balanceLimitation === true,
    standingToleranceMin: profile.standingToleranceMin ?? null,
    accessibilityNeeds: profile.accessibilityNeeds || {},
    preferredAdaptations: profile.preferredAdaptations || [],
  } : {};

  const inputsStamp = maxStamp([
    profile?.updatedAt,
    ...injuries.map(i => i.updatedAt), ...surgeries.map(s => s.updatedAt),
    ...restrictions.map(r => r.updatedAt), ...symptoms.map(s => s.createdAt),
  ]);

  return {
    userId,
    ageYears, activityLevel: user?.activityLevel || null, goalType: user?.goalType || null,
    conditions: conditionKeys,
    injuries, surgeries, restrictions,
    symptomReports: symptoms,
    mobility,
    pregnancyStatus: profile?.pregnancyStatus ?? null,
    postpartumWeeks: profile?.postpartumWeeks ?? null,
    medicationFlags: profile?.medicationActivityFlags || [],
    fitnessExperience: profile?.fitnessExperience ?? null,
    activityPreferences: profile?.activityPreferences || [],
    desiredIntensity: profile?.desiredIntensity ?? null,
    preferences,
    profilePresent: profile != null,
    consentScopes: profile?.consentScopes || {},
    inputsStamp,
    loadedAt: now.toISOString(),
  };
}

function maxStamp(dates) {
  const t = dates.filter(Boolean).map(d => new Date(d).getTime());
  return t.length ? new Date(Math.max(...t)).toISOString() : null;
}

module.exports = { loadSafetyContext, SYMPTOM_ACTIVE_HOURS };
