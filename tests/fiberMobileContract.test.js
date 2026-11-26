// HUM-19 cross-repo contract verification: the mobile client's fiber.ts
// interfaces must match the backend response shapes exactly (top-level keys).
// When the mobile checkout exists as a sibling directory, interfaces are
// parsed live from src/api/fiber.ts — drift in EITHER repo fails this test.
// Without it, shapes are still validated for internal stability.
const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');

const mockFlags = {};
jest.mock('../src/services/featureFlags/service', () => ({
  isEnabled: async (key) => Boolean(mockFlags[key]),
}));

const store = { foodLogs: [], plannedMeals: [], supplementLogs: [] };
jest.mock('../src/lib/prisma', () => ({
  getPrisma: () => ({
    user: { findUnique: async () => ({ id: 'user-a', dateOfBirth: new Date('1990-01-01'), gender: 'female', timeZone: 'UTC' }) },
    macroGoal: { findUnique: async () => ({ caloriesTarget: 2000, fiberTarget: 30 }) },
    userHealthCondition: { findMany: async () => [] },
    userAllergy: { findMany: async () => [] },
    foodLog: { findMany: async () => store.foodLogs },
    weeklyNutritionPlan: { findFirst: async () => null, findMany: async () => [] },
    foodPreference: { findMany: async () => [] },
    supplementLog: { findMany: async () => store.supplementLogs },
    fiberDailyRecommendation: { upsert: async (x) => x, findUnique: async () => null },
  }),
}));

const fiberRouter = require('../src/routes/fiber');
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.userId = 'user-a'; next(); });
app.use('/fiber', fiberRouter);
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

const MOBILE_TS = process.env.MOBILE_FIBER_TS || path.join(__dirname, '../../fitness-app-mobile/src/api/fiber.ts');

function parseInterfaceKeys(src, name) {
  // Only keys at depth 1 — nested object members (e.g. status.confirmedG)
  // are NOT top-level contract keys.
  const m = src.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) return null;
  const keys = [];
  let depth = 1;
  for (const raw of m[1].split('\n')) {
    const l = raw.trim();
    if (depth === 1 && /^[a-zA-Z_]+[?]?:/.test(l)) keys.push(l.split(/[?:]/)[0].trim());
    depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
  }
  return keys.sort();
}

beforeEach(() => {
  Object.keys(mockFlags).forEach((k) => delete mockFlags[k]);
  Object.assign(mockFlags, { fiber_intelligence_enabled: true, fiber_daily_goal_enabled: true });
  store.foodLogs = [{
    id: 'l1', userId: 'user-a', foodName: 'Oats', mealType: 'breakfast', fiberG: 4,
    loggedAt: new Date(), nutritionSnapshot: { fiberBasis: 'confirmed' },
  }];
});

describe('fiber cross-repo contract (mobile fiber.ts)', () => {
  const mobileSrc = fs.existsSync(MOBILE_TS) ? fs.readFileSync(MOBILE_TS, 'utf8') : null;

  it('GET /fiber/target keys match the mobile FiberTarget interface', async () => {
    const res = await request(app).get('/fiber/target');
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body).sort();
    if (mobileSrc) {
      const expected = parseInterfaceKeys(mobileSrc, 'FiberTarget');
      expect(expected).not.toBeNull();
      expect({ backend: keys, mobile: expected }).toEqual({ backend: expected, mobile: expected });
    }
    expect(keys).toContain('targetG');
    expect(keys).toContain('ruleVersion');
  });

  it('GET /fiber/trend day-row keys match FiberTrendDay; envelope carries timezone', async () => {
    const res = await request(app).get('/fiber/trend?days=7');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['days', 'timezone']);
    const dayKeys = Object.keys(res.body.days[0]).sort();
    if (mobileSrc) {
      const expected = parseInterfaceKeys(mobileSrc, 'FiberTrendDay');
      expect(expected).not.toBeNull();
      expect({ backend: dayKeys }).toEqual({ backend: expected });
    }
    expect(dayKeys).toEqual(['confirmedG', 'date', 'mealsLogged', 'targetG', 'unknownMeals'].sort());
  });

  it('GET /fiber/daily keys match the mobile DailyFiber interface', async () => {
    const res = await request(app).get('/fiber/daily');
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body).sort();
    if (mobileSrc) {
      const expected = parseInterfaceKeys(mobileSrc, 'DailyFiber');
      expect(expected).not.toBeNull();
      expect({ backend: keys, mobile: expected }).toEqual({ backend: expected, mobile: expected });
    }
    for (const k of ['date', 'target', 'status', 'perLog', 'inputsHash']) expect(keys).toContain(k);
  });
});
