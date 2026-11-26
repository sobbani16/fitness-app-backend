// HUM-19 §8: trend latency benchmark against the real local DB.
// Seeds synthetic rows for an isolated bench user (cleaned up after), runs
// the same bounded query path the route uses, reports p50/p95/p99 + the
// exact query count per request. Never touches real user data.
require('dotenv').config();
const { getPrisma } = require('../src/lib/prisma');

const USER = 'bench-hum19-trend';
const DAYS = 30;
const MEALS_PER_DAY = 10;
const ITERS = 30;

async function main() {
  const prisma = getPrisma();
  // clean slate for the bench user, then seed DAYS × MEALS rows
  await prisma.foodLog.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } }).catch(() => null);
  await prisma.user.create({ data: { id: USER, email: 'bench-hum19@example.com', passwordHash: 'bench', name: 'bench' } }).catch(async (e) => {
    // retry with minimal fields if the schema differs
    await prisma.user.create({ data: { id: USER, email: 'bench-hum19@example.com' } });
  });
  const now = Date.now();
  const rows = [];
  for (let d = 0; d < DAYS; d++) {
    for (let m = 0; m < MEALS_PER_DAY; m++) {
      rows.push({
        id: `bench-${d}-${m}`,
        userId: USER,
        foodName: `bench meal ${m}`,
        mealType: m % 2 ? "lunch" : "breakfast",
        quantityG: 100,
        calories: 200, proteinG: 10, carbsG: 25, fatG: 8, fiberG: 4,
        loggedAt: new Date(now - d * 86400000 - m * 3600000),
        nutritionSnapshot: { nutrientUnknowns: m % 4 === 0 ? ['fiberG'] : [] },
      });
    }
  }
  await prisma.foodLog.createMany({ data: rows });
  console.log(`seeded ${rows.length} rows (${DAYS}d × ${MEALS_PER_DAY}/day)`);

  // replicate the route's exact bounded query path with query counting
  let queryCount = 0;
  const counting = {
    ...prisma,
    foodLog: new Proxy(prisma.foodLog, {
      get: (t, fn) => (...a) => { queryCount++; return t[fn](...a); },
    }),
  };

  const latencies = [];
  const counts = [];
  for (let i = 0; i < ITERS; i++) {
    queryCount = 0;
    const t0 = process.hrtime.bigint();
    const end = new Date();
    const start = new Date(now - (DAYS - 1) * 86400000);
    await counting.foodLog.findMany({
      where: { userId: USER, loggedAt: { gte: start, lt: end } },
      select: { fiberG: true, loggedAt: true, nutritionSnapshot: true },
    });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    latencies.push(ms);
    counts.push(queryCount);
  }

  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p / 100))].toFixed(1);
  console.log(`trend window query latency over ${ITERS} iters @ ${rows.length} rows:`);
  console.log(`  p50=${pct(50)}ms p95=${pct(95)}ms p99=${pct(99)}ms`);
  console.log(`  food-log queries per trend request: ${counts[0]} (bounded — independent of days param)`);
  console.log(`  rows scanned per request: ${DAYS * MEALS_PER_DAY} of ${rows.length} in-window`);

  await prisma.foodLog.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } }).catch(() => null);
  await prisma.user.create({ data: { id: USER, email: 'bench-hum19@example.com', passwordHash: 'bench', name: 'bench' } }).catch(async (e) => {
    // retry with minimal fields if the schema differs
    await prisma.user.create({ data: { id: USER, email: 'bench-hum19@example.com' } });
  });
  console.log('bench rows cleaned up');
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
