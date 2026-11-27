/**
 * Person-property resolution for provider-side flag targeting.
 *
 * PostHog release conditions can target person properties (e.g.
 * `email icontains humai-internal.test` for internal-tester cohorts).
 * Server-side evaluation only matches those conditions when the properties
 * are supplied with the evaluation request — the provider cannot see the
 * user record otherwise.
 *
 * Minimality: the ONLY property resolved is `email`. Nothing else in this
 * backend shares user data with PostHog (no identify/capture calls exist),
 * so email is the maximum surface required for the documented internal-
 * tester use case — extending this set is a privacy-reviewable event.
 *
 * Verified-only: email is resolved solely when `emailVerifiedAt` is set.
 * Accounts can be created with arbitrary unverified addresses; passing
 * unverified email into targeting would let anyone claim an internal-domain
 * address and join restricted cohorts. Email-change flows likewise leave
 * the new address unverified until confirmed, and targeting must not follow
 * the unverified address.
 *
 * Failure posture: property resolution never throws. A missing user, missing
 * or unverified email, or a database error resolves to {} — evaluation then
 * proceeds without properties, which means property-targeted conditions
 * cannot match (fail-closed for targeted cohorts) while plain-rollout flags
 * keep working. This is strictly less degrading than the provider-outage
 * path, which discards ALL provider results.
 */

const { getPrisma } = require('../../lib/prisma');

async function resolvePersonProperties(userId) {
  try {
    const user = await getPrisma().user.findUnique({
      where: { id: String(userId) },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!user || !user.email || !user.emailVerifiedAt) return {};
    return { email: user.email };
  } catch (err) {
    console.warn(`[featureFlags] person-property resolution failed — evaluating without targeting properties: ${err.message}`);
    return {};
  }
}

module.exports = { resolvePersonProperties };
