// Shared caller-scoped exclusion context for fiber meal ordering — allergies
// and never-recommend/dislike preferences feed the suggestion engine's
// exclusion terms. SINGLE loader for the HTTP route and the Hey Leo/chat
// assistant so both surfaces enforce identical safety semantics.
//
// CONTRACT: never degrade silently. If either lookup fails the error
// propagates — callers must turn that into a sanitized unavailable response
// rather than ordering without the user's recorded exclusions.
async function loadExclusionContext(prisma, userId) {
  const [allergies, prefs] = await Promise.all([
    prisma.userAllergy.findMany({ where: { userId }, include: { allergy: { select: { name: true } } } }),
    prisma.foodPreference.findMany({ where: { userId, preference: { in: ['DISLIKE', 'NEVER_RECOMMEND'] } }, select: { foodName: true } }),
  ]);
  return {
    allergenTerms: new Set(allergies.map((a) => String(a.allergy?.name || '').toLowerCase()).filter(Boolean)),
    avoidNames: new Set(prefs.map((p) => String(p.foodName || '').toLowerCase()).filter(Boolean)),
  };
}

module.exports = { loadExclusionContext };
