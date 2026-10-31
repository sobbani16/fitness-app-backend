// Trainer application workflow — one TrainerProfile row per user doubles as
// the application record. Status machine:
//   draft → submitted → under_review → approved | rejected | changes_requested
// Resubmission is allowed from changes_requested/rejected; a live application
// (submitted/under_review) cannot be overwritten by a new draft.
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { normalizeSpecialties } = require('../config/specialties');

const APPLICATION_FIELDS = [
  'bio', 'certifications', 'specialties', 'yearsExperience', 'tier', 'location',
  'profilePicture', 'displayName', 'languages', 'coachingMode', 'country',
  'timeZone', 'website', 'philosophy',
];

const EDITABLE_STATUSES = ['draft', 'changes_requested', 'rejected'];
const COACHING_MODES = ['online', 'in_person', 'both'];

// Certification payloads may be legacy strings or structured objects
// (the mobile editor sends {name, issuingOrganization, credentialId,
// issuedAt, expiresAt}). String[] stores display names for back-compat;
// objects also produce TrainerCertification rows (always 'unverified').
function certificationNames(certs) {
  return (Array.isArray(certs) ? certs : [])
    .map((c) => (typeof c === 'string' ? c : c && c.name))
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .filter(Boolean);
}

async function syncCertificationEntries(profileId, certs, prisma = getPrisma()) {
  const objects = (Array.isArray(certs) ? certs : []).filter((c) => c && typeof c === 'object' && c.name);
  for (const c of objects) {
    const issuedAt = c.issuedAt ? new Date(c.issuedAt) : null;
    const expiresAt = c.expiresAt ? new Date(c.expiresAt) : null;
    await prisma.trainerCertification.create({
      data: {
        trainerId: profileId,
        name: String(c.name).trim().slice(0, 200),
        issuingOrganization: c.issuingOrganization || c.organization || null,
        credentialId: c.credentialId || null,
        issuedAt: issuedAt && !Number.isNaN(issuedAt.getTime()) ? issuedAt : null,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        verificationStatus: 'unverified',
      },
    });
  }
}

function pickApplicationFields(updates) {
  const data = {};
  for (const key of APPLICATION_FIELDS) {
    if (updates[key] === undefined) continue;
    if (key === 'specialties') {
      data.specialties = normalizeSpecialties(updates.specialties);
    } else if (key === 'coachingMode') {
      if (!COACHING_MODES.includes(updates.coachingMode)) {
        throw httpError(400, `Invalid coachingMode: ${updates.coachingMode}`);
      }
      data.coachingMode = updates.coachingMode;
    } else if (key === 'tier') {
      data.tier = ['standard', 'pro', 'elite'].includes(updates.tier) ? updates.tier : 'standard';
    } else {
      data[key] = updates[key];
    }
  }
  return data;
}

async function getMyApplication(userId) {
  const prisma = getPrisma();
  const profile = await prisma.trainerProfile.findUnique({ where: { userId } });
  if (!profile) throw httpError(404, 'No trainer application found.');
  return {
    id: profile.id,
    applicationStatus: profile.applicationStatus,
    applicationNote: profile.applicationNote,
    approvedAt: profile.approvedAt,
    bio: profile.bio,
    certifications: profile.certifications,
    specialties: profile.specialties,
    yearsExperience: profile.yearsExperience,
    tier: profile.tier,
    location: profile.location,
    displayName: profile.displayName,
    languages: profile.languages,
    coachingMode: profile.coachingMode,
    country: profile.country,
    timeZone: profile.timeZone,
    website: profile.website,
    philosophy: profile.philosophy,
    updatedAt: profile.updatedAt,
  };
}

/**
 * POST /applications — save (or overwrite) a draft application. Blocked while
 * a live application is being reviewed or the user is already approved.
 */
async function saveDraft(userId, updates, prisma = getPrisma()) {
  const existing = await prisma.trainerProfile.findUnique({ where: { userId } });
  if (existing) {
    if (['submitted', 'under_review'].includes(existing.applicationStatus)) {
      throw httpError(409, 'Application already submitted and under review.');
    }
    if (existing.applicationStatus === 'approved') {
      throw httpError(409, 'Trainer application already approved.');
    }
    const data = pickApplicationFields(updates || {});
    const profile = await prisma.trainerProfile.update({
      where: { userId },
      data: { ...data, certifications: certificationNames(data.certifications), applicationStatus: 'draft', applicationNote: null },
    });
    if (data.certifications) await syncCertificationEntries(profile.id, updates.certifications, prisma);
    return profile;
  }
  const data = pickApplicationFields(updates || {});
  const profile = await prisma.trainerProfile.create({
    data: {
      userId,
      bio: data.bio || null,
      certifications: certificationNames(data.certifications),
      specialties: data.specialties || [],
      yearsExperience: data.yearsExperience || 0,
      tier: data.tier || 'standard',
      location: data.location || null,
      profilePicture: data.profilePicture || null,
      displayName: data.displayName || null,
      languages: data.languages || [],
      coachingMode: data.coachingMode || 'both',
      country: data.country || null,
      timeZone: data.timeZone || null,
      website: data.website || null,
      philosophy: data.philosophy || null,
      verified: false,
      active: false,
      applicationStatus: 'draft',
    },
  });
  await syncCertificationEntries(profile.id, updates.certifications, prisma);
  return profile;
}

/** PATCH /applications/me — edit an existing draft/changes_requested draft. */
async function updateDraft(userId, updates, prisma = getPrisma()) {
  const profile = await prisma.trainerProfile.findUnique({ where: { userId } });
  if (!profile) throw httpError(404, 'No trainer application found.');
  if (!['draft', 'changes_requested'].includes(profile.applicationStatus)) {
    throw httpError(409, `Application cannot be edited while ${profile.applicationStatus}.`);
  }
  const data = pickApplicationFields(updates || {});
  if (data.certifications !== undefined) data.certifications = certificationNames(data.certifications);
  const updated = await prisma.trainerProfile.update({ where: { userId }, data });
  if (updates.certifications !== undefined) await syncCertificationEntries(profile.id, updates.certifications, prisma);
  return updated;
}

/** POST /applications/me/submit — validates completeness then submits. */
async function submitApplication(userId, prisma = getPrisma()) {
  const profile = await prisma.trainerProfile.findUnique({ where: { userId } });
  if (!profile) throw httpError(404, 'No trainer application found. Save a draft first.');
  if (!EDITABLE_STATUSES.includes(profile.applicationStatus)) {
    throw httpError(409, `Application already ${profile.applicationStatus}.`);
  }
  if (!profile.bio || !profile.bio.trim()) throw httpError(400, 'bio is required.');
  if (!Number.isInteger(profile.yearsExperience) || profile.yearsExperience < 0) {
    throw httpError(400, 'yearsExperience is required.');
  }
  if (!Array.isArray(profile.specialties) || profile.specialties.length === 0) {
    throw httpError(400, 'Select at least one specialty.');
  }
  return prisma.trainerProfile.update({
    where: { userId },
    data: { applicationStatus: 'submitted' },
  });
}

// ---------------------------------------------------------------------------
// Structured certifications — trainer-managed; verification is admin-only so
// every write forces verificationStatus back to 'unverified'.
// ---------------------------------------------------------------------------

const CERT_FIELDS = ['name', 'issuingOrganization', 'credentialId', 'issuedAt', 'expiresAt'];

async function requireOwnProfile(userId, prisma = getPrisma()) {
  const profile = await prisma.trainerProfile.findUnique({ where: { userId } });
  if (!profile) throw httpError(404, 'Trainer profile not found.');
  return profile;
}

function pickCertFields(updates, { partial } = {}) {
  const data = {};
  for (const key of CERT_FIELDS) {
    if (updates[key] === undefined) continue;
    if ((key === 'issuedAt' || key === 'expiresAt') && updates[key]) {
      const parsed = new Date(updates[key]);
      if (Number.isNaN(parsed.getTime())) throw httpError(400, `Invalid ${key} date.`);
      data[key] = parsed;
    } else {
      data[key] = updates[key];
    }
  }
  if (!partial && (!data.name || typeof data.name !== 'string' || !data.name.trim())) {
    throw httpError(400, 'name is required.');
  }
  return data;
}

async function listCertifications(userId) {
  const prisma = getPrisma();
  const profile = await requireOwnProfile(userId, prisma);
  return prisma.trainerCertification.findMany({
    where: { trainerId: profile.id },
    orderBy: { createdAt: 'desc' },
  });
}

async function addCertification(userId, updates, prisma = getPrisma()) {
  const profile = await requireOwnProfile(userId, prisma);
  const data = pickCertFields(updates || {});
  return prisma.trainerCertification.create({
    data: { ...data, trainerId: profile.id, verificationStatus: 'unverified' },
  });
}

async function updateCertification(userId, certId, updates, prisma = getPrisma()) {
  const profile = await requireOwnProfile(userId, prisma);
  const cert = await prisma.trainerCertification.findUnique({ where: { id: certId } });
  if (!cert || cert.trainerId !== profile.id) throw httpError(404, 'Certification not found.');
  const data = pickCertFields(updates || {}, { partial: true });
  // Any edit invalidates prior verification.
  return prisma.trainerCertification.update({
    where: { id: certId },
    data: { ...data, verificationStatus: 'unverified', verifiedAt: null, verifiedBy: null },
  });
}

async function deleteCertification(userId, certId, prisma = getPrisma()) {
  const profile = await requireOwnProfile(userId, prisma);
  const cert = await prisma.trainerCertification.findUnique({ where: { id: certId } });
  if (!cert || cert.trainerId !== profile.id) throw httpError(404, 'Certification not found.');
  await prisma.trainerCertification.delete({ where: { id: certId } });
  return { ok: true };
}

module.exports = {
  certificationNames,
  syncCertificationEntries,
  getMyApplication,
  saveDraft,
  updateDraft,
  submitApplication,
  listCertifications,
  addCertification,
  updateCertification,
  deleteCertification,
};
