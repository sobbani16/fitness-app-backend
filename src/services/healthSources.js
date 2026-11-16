// Wearable-ready health platform — provider adapters, idempotent ingest,
// interval-aware dedup, derived summaries. HUMAI_BAND is registered but
// NOT_AVAILABLE (no hardware exists). Synthetic provider is internal-only.
const prisma = require('../lib/prisma');
//

// Provider registry — capabilities are honest; band availability is stubbed.
const PROVIDERS = {
  apple_health: { id: 'apple_health', label: 'Apple Health', availability: 'available', kind: 'aggregate', metrics: ['heart_rate', 'resting_heart_rate', 'hrv_sdnn', 'steps', 'sleep', 'active_energy', 'resting_energy', 'workout'], pairing: false, firmware: false },
  health_connect: { id: 'health_connect', label: 'Android Health Connect', availability: 'available', kind: 'aggregate', metrics: ['heart_rate', 'resting_heart_rate', 'hrv_sdnn', 'hrv_rmssd', 'steps', 'sleep', 'active_energy', 'workout'], pairing: false, firmware: false },
  manual: { id: 'manual', label: 'Manual entry', availability: 'available', kind: 'manual', metrics: ['steps', 'heart_rate', 'sleep'], pairing: false, firmware: false },
  humai_band: { id: 'humai_band', label: 'Humai Band', availability: 'not_available', kind: 'ble_device', metrics: [], pairing: true, firmware: true, note: 'Hardware not yet selected — provider stub only. See docs/humai-band-vendor-integration.md' },
  internal_sim: { id: 'internal_sim', label: 'Synthetic test provider', availability: 'internal', kind: 'simulated', metrics: ['heart_rate', 'hrv_rmssd', 'steps', 'sleep', 'active_energy'], pairing: false, firmware: false },
};

// Provider precedence for overlapping-interval reconciliation: direct device
// data wins over phone aggregators, which win over manual entries.
const PRECEDENCE = ['humai_band', 'apple_health', 'health_connect', 'internal_sim', 'manual'];
const INTERVAL_METRICS = new Set(['steps', 'active_energy', 'resting_energy', 'sleep']);
const VALID_METRICS = new Set(['heart_rate', 'resting_heart_rate', 'hrv_sdnn', 'hrv_rmssd', 'steps', 'sleep', 'active_energy', 'resting_energy', 'workout']);

function listProviders(user) {
  const out = [];
  for (const p of Object.values(PROVIDERS)) {
    if (p.id === 'internal_sim' && !user?.isSuperAdmin && process.env.NODE_ENV === 'production') continue;
    out.push({ ...p });
  }
  return out;
}

async function listSources(userId) {
  const sources = await prisma.healthDataSource.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  return sources.map((s) => ({ ...s, provider: { ...PROVIDERS[s.provider] } }));
}

async function connectSource(userId, providerId, { scopes = [] } = {}) {
  const p = PROVIDERS[providerId];
  if (!p) { const e = new Error('Unknown provider'); e.status = 400; throw e; }
  if (p.availability === 'not_available') { const e = new Error(`${p.label} is not yet available`); e.status = 409; throw e; }
  const source = await prisma.healthDataSource.upsert({
    where: { userId_provider: { userId, provider: providerId } },
    create: { userId, provider: providerId, permissionScopes: scopes, connectionState: 'connected' },
    update: { connectionState: 'connected', permissionScopes: scopes, lastError: null },
  });
  return source;
}

async function disconnectSource(userId, providerId) {
  const src = await prisma.healthDataSource.findUnique({ where: { userId_provider: { userId, provider: providerId } } });
  if (!src) { const e = new Error('Source not found'); e.status = 404; throw e; }
  // Revoke keeps history — deletion is a separate explicit action.
  await prisma.healthDataSource.update({ where: { id: src.id }, data: { connectionState: 'revoked' } });
  await prisma.wearableDevice.updateMany({ where: { userId, provider: providerId }, data: { connectionState: 'revoked' } });
  return { revoked: true, recordsRetained: true };
}

async function deleteSourceData(userId, providerId) {
  const src = await prisma.healthDataSource.findUnique({ where: { userId_provider: { userId, provider: providerId } } });
  if (!src) { const e = new Error('Source not found'); e.status = 404; throw e; }
  const del = await prisma.healthMeasurement.deleteMany({ where: { userId, provider: providerId } });
  await prisma.healthSyncCursor.deleteMany({ where: { sourceId: src.id } });
  await prisma.healthDataSource.delete({ where: { id: src.id } });
  return { deleted: del.count };
}

// --- Ingest: validate, normalize, idempotent upsert ---------------------------

function validateRecord(r) {
  if (!r || typeof r !== 'object') return 'record must be an object';
  if (!VALID_METRICS.has(r.metric)) return `metric must be one of: ${[...VALID_METRICS].join(', ')}`;
  if (!r.unit) return 'unit required';
  if (!r.startAt) return 'startAt required';
  const s = new Date(r.startAt);
  if (isNaN(s.getTime())) return 'startAt must be a valid datetime';
  if (r.endAt && isNaN(new Date(r.endAt).getTime())) return 'endAt must be a valid datetime';
  if (r.value !== undefined && r.value !== null && typeof r.value !== 'number') return 'value must be a number';
  if (/^hrv_/.test(r.metric) && !r.meta?.statistic && !/^hrv_(sdnn|rmssd)$/.test(r.metric)) return 'HRV records must declare the statistic (sdnn|rmssd) — incompatible HRV measures are never mixed';
  return null;
}

async function ingestMeasurements(userId, providerId, records) {
  const src = await prisma.healthDataSource.findUnique({ where: { userId_provider: { userId, provider: providerId } } });
  if (!src) { const e = new Error('Connect this provider first'); e.status = 409; throw e; }
  if (src.connectionState === 'revoked') { const e = new Error('Provider access was revoked — reconnect to sync'); e.status = 403; throw e; }
  const provider = PROVIDERS[providerId];
  if (!provider) { const e = new Error('Unknown provider'); e.status = 400; throw e; }

  let accepted = 0, duplicates = 0;
  const errors = [];
  await prisma.healthDataSource.update({ where: { id: src.id }, data: { lastAttemptAt: new Date() } });

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const err = validateRecord(r);
    if (err) { errors.push({ index: i, error: err }); continue; }
    if (!provider.metrics.includes(r.metric) && providerId !== 'manual') { errors.push({ index: i, error: `${providerId} does not support metric ${r.metric}` }); continue; }
    const data = {
      userId, sourceId: src.id, provider: providerId,
      externalId: r.externalId || null, metric: r.metric, value: r.value ?? null,
      unit: r.unit, startAt: new Date(r.startAt), endAt: r.endAt ? new Date(r.endAt) : null,
      timezone: r.timezone || null, quality: r.quality || 'measured',
      synthetic: providerId === 'internal_sim' ? true : Boolean(r.synthetic && providerId === 'internal_sim'),
      meta: { ...(r.meta || {}), sourceUnit: r.sourceUnit || r.unit },
    };
    // Idempotency: (userId, provider, externalId) — skip exact re-deliveries
    if (data.externalId) {
      const existing = await prisma.healthMeasurement.findFirst({ where: { userId, provider: providerId, externalId: data.externalId } });
      if (existing) {
        // Provider corrected/deleted handling: update value if it changed
        if (existing.value !== data.value || String(existing.startAt) !== String(data.startAt)) {
          await prisma.healthMeasurement.update({ where: { id: existing.id }, data: { value: data.value, startAt: data.startAt, endAt: data.endAt, meta: { ...existing.meta, correctedAt: new Date().toISOString() } } });
        }
        duplicates++; continue;
      }
    }
    // Interval overlap check within the same provider (device re-backfill)
    if (!data.externalId && INTERVAL_METRICS.has(r.metric) && data.endAt) {
      const overlap = await prisma.healthMeasurement.findFirst({ where: { userId, provider: providerId, metric: r.metric, startAt: { lt: data.endAt }, endAt: { gt: data.startAt } } });
      if (overlap) { duplicates++; continue; }
    }
    await prisma.healthMeasurement.create({ data });
    accepted++;
  }
  await prisma.healthDataSource.update({ where: { id: src.id }, data: { lastSyncAt: new Date(), lastError: errors.length ? `${errors.length} record(s) rejected` : null } });
  // Advance sync cursors — incremental adapters resume from the newest
  // checkpoint per metric rather than rescanning.
  const latestByMetric = {};
  for (const r of records) { const t = new Date(r.startAt).getTime(); if (!latestByMetric[r.metric] || t > latestByMetric[r.metric]) latestByMetric[r.metric] = t; }
  for (const [metric, t] of Object.entries(latestByMetric)) {
    if (typeof prisma.healthSyncCursor?.upsert !== 'function') break;
    await prisma.healthSyncCursor.upsert({
      where: { sourceId_metric: { sourceId: src.id, metric } },
      create: { sourceId: src.id, metric, lastCheckpoint: new Date(t) },
      update: { lastCheckpoint: new Date(t), retryCount: 0, lastError: null },
    }).catch(() => {});
  }
  return { accepted, duplicates, rejected: errors.length, errors: errors.slice(0, 20) };
}

// --- Query: bounded series + deduplicated daily summaries ----------------------

async function getSeries(userId, { metric, from, to, limit = 500, includeSynthetic = false }) {
  if (!VALID_METRICS.has(metric)) { const e = new Error('unknown metric'); e.status = 400; throw e; }
  const where = { userId, metric, startAt: { gte: from ? new Date(from) : new Date(Date.now() - 90 * 864e5), lte: to ? new Date(to) : new Date() } };
  if (!includeSynthetic) where.synthetic = false;
  const rows = await prisma.healthMeasurement.findMany({ where, orderBy: { startAt: 'asc' }, take: Math.min(limit, 5000) });
  return rows.map((r) => ({ id: r.id, metric: r.metric, value: r.value, unit: r.unit, startAt: r.startAt, endAt: r.endAt, provider: r.provider, quality: r.quality, timezone: r.timezone, meta: r.meta }));
}

// Daily totals with cross-provider overlap reconciliation. Same measurement
// arriving via two providers is counted once — precedence decides which.
function reconcileDaily(rows) {
  // Bucket interval rows per UTC day; per day+metric pick highest-precedence provider set.
  const byDay = new Map();
  for (const r of rows) {
    const day = r.startAt.toISOString().slice(0, 10);
    const key = `${day}|${r.metric}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(r);
  }
  const out = [];
  for (const [key, rs] of byDay) {
    const [day, metric] = key.split('|');
    const providers = [...new Set(rs.map((r) => r.provider))];
    const chosen = providers.sort((a, b) => PRECEDENCE.indexOf(a) - PRECEDENCE.indexOf(b))[0];
    const use = rs.filter((r) => r.provider === chosen).sort((a, b) => a.startAt - b.startAt);
    // Within one provider, merge overlapping intervals (take union extent for
    // interval metrics, sum point metrics)
    let value = 0;
    let cursor = null;
    for (const r of use) {
      if (INTERVAL_METRICS.has(metric) && r.endAt && cursor && r.startAt < cursor) continue; // overlaps counted interval
      value += r.value || 0;
      cursor = r.endAt || cursor;
    }
    out.push({ day, metric, value: Math.round(value * 100) / 100, unit: use[0]?.unit, provider: chosen, providersSeen: providers, recordCount: use.length });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

async function getDailySummary(userId, { metric, days = 14 }) {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await prisma.healthMeasurement.findMany({ where: { userId, metric, synthetic: false, startAt: { gte: since } }, orderBy: { startAt: 'asc' } });
  return { metric, days, summary: reconcileDaily(rows) };
}

// --- Recovery observations — descriptive trends or INSUFFICIENT_DATA ---------

async function getRecovery(userId) {
  const since = new Date(Date.now() - 28 * 864e5);
  const [rhr, hrv, sleep, sessions] = await Promise.all([
    prisma.healthMeasurement.findMany({ where: { userId, metric: 'resting_heart_rate', synthetic: false, startAt: { gte: since } }, orderBy: { startAt: 'asc' } }),
    prisma.healthMeasurement.findMany({ where: { userId, metric: { in: ['hrv_sdnn', 'hrv_rmssd'] }, synthetic: false, startAt: { gte: since } }, orderBy: { startAt: 'asc' } }),
    prisma.sleepLog.findMany({ where: { userId, date: { gte: since } }, orderBy: { date: 'asc' } }),
    prisma.workoutSession.count({ where: { userId, finishedAt: { gte: since } } }),
  ]);
  const coverage = { restingHeartRateDays: rhr.length, hrvDays: hrv.length, sleepNights: sleep.length, workouts: sessions };
  const available = Object.values(coverage).filter((v) => v >= 5).length;
  if (available < 2) {
    return { status: 'INSUFFICIENT_DATA', coverage, note: 'At least ~5 days in two data categories are needed before trends are shown.' };
  }
  const avg = (arr, f) => arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : 0;
  const half = Math.floor(sleep.length / 2);
  const trends = [];
  if (sleep.length >= 5) {
    const recent = avg(sleep.slice(half), (s) => s.durationMin || 0), earlier = avg(sleep.slice(0, half), (s) => s.durationMin || 0);
    trends.push({ metric: 'sleep', direction: recent > earlier + 10 ? 'improving' : recent < earlier - 10 ? 'declining' : 'steady', note: `Recent average ${Math.round(recent)} min vs earlier ${Math.round(earlier)} min.` });
  }
  if (rhr.length >= 5) {
    const h = Math.floor(rhr.length / 2);
    const recent = avg(rhr.slice(h), (x) => x.value), earlier = avg(rhr.slice(0, h), (x) => x.value);
    trends.push({ metric: 'resting_heart_rate', direction: recent < earlier - 1 ? 'improving' : recent > earlier + 2 ? 'elevated' : 'steady', note: `Recent avg ${recent.toFixed(0)} vs earlier ${earlier.toFixed(0)} bpm.` });
  }
  if (hrv.length >= 5) {
    const stat = hrv[0].metric; // never mix sdnn/rmssd — one statistic per trend
    const same = hrv.filter((x) => x.metric === stat);
    const h = Math.floor(same.length / 2);
    const recent = avg(same.slice(h), (x) => x.value), earlier = avg(same.slice(0, h), (x) => x.value);
    trends.push({ metric: stat, direction: recent > earlier * 1.05 ? 'higher' : recent < earlier * 0.9 ? 'lower' : 'steady', note: `${stat.toUpperCase()} recent avg ${recent.toFixed(0)} vs ${earlier.toFixed(0)} ms. Higher is not always better — context matters.` });
  }
  return {
    status: 'OK', calcVersion: 'descriptive_v1', coverage, trends,
    disclaimer: 'Descriptive trends from your recorded data — not a clinical recovery score.',
  };
}

// --- Internal synthetic provider (deterministic fixtures) ----------------------

function simFixtures(kind, days = 7) {
  const out = [];
  const now = Date.now();
  for (let d = 0; d < days; d++) {
    const day = new Date(now - d * 864e5);
    const base = day.toISOString().slice(0, 10);
    if (kind === 'steps' || kind === 'all') out.push({ metric: 'steps', value: 6000 + (d * 137) % 4000, unit: 'count', startAt: `${base}T00:00:00Z`, endAt: `${base}T23:59:00Z`, externalId: `sim-steps-${base}` });
    if (kind === 'heart_rate' || kind === 'all') for (let h = 8; h < 22; h += 2) out.push({ metric: 'heart_rate', value: 62 + ((d + h) % 17), unit: 'bpm', startAt: `${base}T${String(h).padStart(2, '0')}:00:00Z`, externalId: `sim-hr-${base}-${h}` });
    if (kind === 'hrv' || kind === 'all') out.push({ metric: 'hrv_rmssd', value: 34 + (d % 9), unit: 'ms', startAt: `${base}T06:00:00Z`, externalId: `sim-hrv-${base}` });
    if (kind === 'sleep' || kind === 'all') out.push({ metric: 'sleep', value: 380 + (d % 5) * 20, unit: 'min', startAt: `${base}T23:00:00Z`, endAt: `${new Date(day.getTime() + 7 * 36e5).toISOString()}`, externalId: `sim-sleep-${base}` });
  }
  return out.map((r) => ({ ...r, quality: 'measured', meta: { synthetic: true } }));
}

module.exports = {
  PROVIDERS, PRECEDENCE, VALID_METRICS, listProviders, listSources,
  connectSource, disconnectSource, deleteSourceData,
  ingestMeasurements, getSeries, getDailySummary, getRecovery, simFixtures, reconcileDaily,
};
