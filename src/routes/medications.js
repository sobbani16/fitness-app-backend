// /me/medications — user medication records for recommendation safety (F-C3).
// This is a safety-input registry, NOT a prescription manager. Names are stored
// verbatim; classification is deterministic against a limited curated catalog —
// unclassified entries yield no safety flags rather than invented interactions.
const router = require('express').Router();
const { getPrisma } = require('../lib/prisma');
const { httpError } = require('../lib/errors');
const { requireFeature } = require('../middleware/requireFeature');
const M = require('../services/healthOutcomes/medicationCatalog');
const audit = require('../services/auditService');
const { getUserId } = require('../middleware/rbac');
const uid = req => req.userId || getUserId(req);

router.use(requireFeature('user_medications'));

const NOTICE = 'This information helps Humai identify situations where personalized nutrition or activity guidance may require additional precautions. Do not change medications based on Humai recommendations.';
const DOSE_UNITS = new Set(['mg', 'mcg', 'g', 'ml', 'units', 'iu', 'tablet', 'capsule', 'puff', 'patch', 'other']);
const NAME_RE = /^[\p{L}\p{N} .,'()\/+\-]{2,120}$/u;
const validDate = (v) => v == null || (!Number.isNaN(new Date(v).getTime()) && new Date(v) <= new Date());

const view = (m) => ({
  id: m.id,
  name: m.medication?.name || m.nameText,
  medicationId: m.medicationId,
  medicationClass: m.medicationClass || m.medication?.medicationClass || null,
  classified: !!(m.medicationClass || m.medication?.medicationClass),
  doseText: m.doseText,
  doseValue: m.doseValue,
  doseUnit: m.doseUnit,
  schedule: m.schedule,
  startDate: m.startDate,
  endDate: m.endDate,
  active: m.active,
  source: m.source,
  lastConfirmedAt: m.lastConfirmedAt,
  stale: M.isStale(m),
  createdAt: m.createdAt,
});

function validateBody(b, partial) {
  if (!partial || b.name !== undefined) {
    const name = b.name ?? b.nameText;
    if (typeof name !== 'string' || !NAME_RE.test(name.trim())) throw httpError(400, 'name must be 2–120 characters of text.');
  }
  if (b.doseText != null && (typeof b.doseText !== 'string' || b.doseText.length > 120)) throw httpError(400, 'doseText must be ≤ 120 characters.');
  if (b.doseValue != null && (typeof b.doseValue !== 'number' || !(b.doseValue > 0) || b.doseValue > 100000)) throw httpError(400, 'doseValue must be a positive number ≤ 100000.');
  if (b.doseUnit != null && !DOSE_UNITS.has(String(b.doseUnit).toLowerCase())) throw httpError(400, `doseUnit must be one of: ${[...DOSE_UNITS].join(', ')}`);
  if (!validDate(b.startDate)) throw httpError(400, 'startDate must be a past date.');
  if (b.endDate !== undefined && b.endDate !== null && Number.isNaN(new Date(b.endDate).getTime())) throw httpError(400, 'endDate must be a date.');
  if (b.schedule != null && (typeof b.schedule !== 'object' || Array.isArray(b.schedule))) throw httpError(400, 'schedule must be an object like { times: ["08:00"] }.');
}

router.get('/', async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const rows = await prisma.userMedication.findMany({ where: { userId: uid(req) }, include: { medication: true }, orderBy: { createdAt: 'asc' } });
    const ctx = await M.loadMedicationSafetyContext(prisma, uid(req));
    res.json({
      medications: rows.filter(m => m.active).map(view),
      inactive: rows.filter(m => !m.active).map(view),
      safetyFlags: [...ctx.flags],
      unclassifiedCount: ctx.unclassified.length,
      notice: NOTICE,
    });
  } catch (e) { next(e); }
});

// POST /me/medications { name, doseText?, doseValue?, doseUnit?, schedule?, startDate?, consent: true }
router.post('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.consent !== true) throw httpError(400, 'consent: true is required to record a medication.');
    validateBody(b, false);
    const prisma = getPrisma();
    const nameText = String(b.name ?? b.nameText).trim();
    const cls = M.classify(nameText);
    // Catalog row: deterministic normalized-name match only. If the name is in
    // the curated alias map a catalog row is materialized; otherwise the entry
    // stays text-only (medicationId=null) — never fuzzy-matched to another drug.
    let medication = null;
    if (cls) {
      const normalized = M.normalize(nameText);
      medication = await prisma.medication.upsert({
        where: { normalizedName: normalized },
        update: { medicationClass: cls },
        create: { name: nameText, normalizedName: normalized, medicationClass: cls },
      });
    }
    const now = new Date();
    const saved = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${uid(req)} FOR UPDATE`;
      const dup = await tx.userMedication.findFirst({ where: { userId: uid(req), active: true, nameText: { equals: nameText, mode: 'insensitive' } } });
      if (dup) {
        return tx.userMedication.update({ where: { id: dup.id }, data: { doseText: b.doseText ?? dup.doseText, doseValue: b.doseValue ?? dup.doseValue, doseUnit: b.doseUnit ? String(b.doseUnit).toLowerCase() : dup.doseUnit, schedule: b.schedule ?? dup.schedule, lastConfirmedAt: now }, include: { medication: true } });
      }
      return tx.userMedication.create({
        data: { userId: uid(req), medicationId: medication?.id || null, nameText, doseText: b.doseText ?? null, doseValue: b.doseValue ?? null, doseUnit: b.doseUnit ? String(b.doseUnit).toLowerCase() : null, schedule: b.schedule ?? undefined, medicationClass: cls, startDate: b.startDate ? new Date(b.startDate) : null, source: 'user_entry', lastConfirmedAt: now, consentedAt: now },
        include: { medication: true },
      });
    });
    await audit.log({ actorId: uid(req), action: 'medication.add', entityType: 'UserMedication', entityId: saved.id, afterData: { classified: !!cls } }).catch(() => null);
    res.status(201).json({ medication: view(saved), safetyFlags: [...(await M.loadMedicationSafetyContext(prisma, uid(req))).flags], notice: NOTICE });
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const b = req.body || {};
    validateBody(b, true);
    const prisma = getPrisma();
    const row = await prisma.userMedication.findFirst({ where: { id: req.params.id, userId: uid(req) } });
    if (!row) throw httpError(404, 'Medication not found.');
    const newName = b.name !== undefined || b.nameText !== undefined ? String(b.name ?? b.nameText).trim() : null;
    const cls = newName ? M.classify(newName) : row.medicationClass;
    let medicationId = row.medicationId;
    if (newName && cls) {
      const normalized = M.normalize(newName);
      const med = await prisma.medication.upsert({ where: { normalizedName: normalized }, update: { medicationClass: cls }, create: { name: newName, normalizedName: normalized, medicationClass: cls } });
      medicationId = med.id;
    } else if (newName && !cls) medicationId = null;
    const updated = await prisma.userMedication.update({
      where: { id: row.id },
      data: {
        ...(newName ? { nameText: newName, medicationClass: cls, medicationId } : {}),
        ...(b.doseText !== undefined ? { doseText: b.doseText } : {}),
        ...(b.doseValue !== undefined ? { doseValue: b.doseValue } : {}),
        ...(b.doseUnit !== undefined ? { doseUnit: b.doseUnit ? String(b.doseUnit).toLowerCase() : null } : {}),
        ...(b.schedule !== undefined ? { schedule: b.schedule } : {}),
        ...(b.startDate !== undefined ? { startDate: b.startDate ? new Date(b.startDate) : null } : {}),
        ...(b.endDate !== undefined ? { endDate: b.endDate ? new Date(b.endDate) : null } : {}),
        lastConfirmedAt: new Date(),
      },
      include: { medication: true },
    });
    await audit.log({ actorId: uid(req), action: 'medication.update', entityType: 'UserMedication', entityId: row.id }).catch(() => null);
    res.json({ medication: view(updated) });
  } catch (e) { next(e); }
});

// POST /me/medications/:id/confirm — resets the staleness clock without edits.
router.post('/:id/confirm', async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const row = await prisma.userMedication.findFirst({ where: { id: req.params.id, userId: uid(req), active: true } });
    if (!row) throw httpError(404, 'Medication not found.');
    const updated = await prisma.userMedication.update({ where: { id: row.id }, data: { lastConfirmedAt: new Date() }, include: { medication: true } });
    res.json({ medication: view(updated) });
  } catch (e) { next(e); }
});

// DELETE /me/medications/:id — deactivates (provenance kept; active=false stops
// all safety-context influence). Account deletion removes rows entirely.
router.delete('/:id', async (req, res, next) => {
  try {
    const prisma = getPrisma();
    const row = await prisma.userMedication.findFirst({ where: { id: req.params.id, userId: uid(req) } });
    if (!row) throw httpError(404, 'Medication not found.');
    await prisma.userMedication.update({ where: { id: row.id }, data: { active: false, endDate: new Date() } });
    await audit.log({ actorId: uid(req), action: 'medication.remove', entityType: 'UserMedication', entityId: row.id }).catch(() => null);
    res.json({ removed: true, id: row.id });
  } catch (e) { next(e); }
});

module.exports = router;
