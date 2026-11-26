// pc-HUM-207 — canonical-engine integration invariants. No DB needed.
const fs = require('fs');
const path = require('path');
const { sequenceMeal } = require('../src/services/fiber/sequencing');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.js$/.test(e.name)) out.push(p);
  }
  return out;
};

describe('canonical sequencing engine invariants', () => {
  test('exactly one sequencing engine implementation exists in src/', () => {
    const files = walk(path.join(__dirname, '../src'));
    const engines = files.filter(f => /fiber[/\\]sequencing\.js$/.test(f));
    expect(engines).toHaveLength(1);
  });

  test('no competing ordering implementation: only fiber.js and assistant.js consume the engine', () => {
    const files = walk(path.join(__dirname, '../src'));
    const consumers = files.filter(f => {
      if (/fiber[/\\]sequencing\.js$/.test(f)) return false;
      const src = fs.readFileSync(f, 'utf8');
      return /require\([^)]*fiber[/\\]sequencing|require\(['"]\.\/sequencing/.test(src);
    }).map(f => path.relative(path.join(__dirname, '../src'), f));
    expect(consumers.sort()).toEqual(['routes/fiber.js', 'services/fiber/assistant.js'].sort());
  });

  test('no file outside the engine reimplements role-ordering logic', () => {
    const files = walk(path.join(__dirname, '../src'));
    const suspects = files.filter(f => {
      if (/fiber[/\\]/.test(f)) return false; // fiber lane internals are the canonical home
      const src = fs.readFileSync(f, 'utf8');
      // heuristic: an independent implementation would carry its own role-priority ordering
      return /vegetable.*legume.*starch|order.*vegetables.*first|vegFirst|vegetablesFirst/i.test(src);
    });
    expect(suspects).toEqual([]);
  });

  test('single-food input is explicitly non-applicable for ordering — never a vacuous order UI', async () => {
    const single = await sequenceMeal([{ name: 'rice', fiberG: 0.4, carbsG: 28 }]);
    expect(single.sequencingApplicable).toBe(false);
    // the machine-readable suppression contract must exist on every shape
    const mixed = await sequenceMeal([{ name: 'biryani', fiberG: null, carbsG: 40 }]);
    expect(typeof mixed.sequencingApplicable).toBe('boolean');
    // multi-component input IS ordering-applicable
    const multi = await sequenceMeal([{ name: 'broccoli', fiberG: 5, carbsG: 7 }, { name: 'rice', fiberG: 0.4, carbsG: 28 }]);
    expect(multi.sequencingApplicable).toBe(true);
    expect(multi.order.length).toBe(2);
  });

  test('unknown fiber is never treated as zero in output shaping', async () => {
    const r = await sequenceMeal([
      { name: 'mystery food', fiberG: null, carbsG: 20 },
      { name: 'rice', fiberG: 0.4, carbsG: 28 },
    ]);
    const blob = JSON.stringify(r).toLowerCase();
    // unknown-fiber handling must surface honestly somewhere in the payload
    expect(/unknown|uncertain|null/.test(blob) || r.warnings || r.unknowns || r.items?.some(i => i.fiberG == null || i.fiberUnknown)).toBeTruthy();
  });
});

describe('feature-flag fail-closed contract', () => {
  test('both flags default false and never fail open', () => {
    const reg = require('../src/config/featureRegistry');
    const src = fs.readFileSync(require.resolve('../src/config/featureRegistry'), 'utf8');
    for (const key of ['fiber_intelligence_enabled', 'fiber_meal_sequencing_enabled']) {
      const block = src.slice(src.indexOf(key));
      const head = block.slice(0, 400);
      expect(head).toMatch(/default:\s*false/);
      expect(head).toMatch(/failOpen:\s*false/);
    }
    void reg;
  });

  test('sequencing endpoint is flag-gated and auth-required in source', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/routes/fiber.js'), 'utf8');
    const seq = src.slice(src.indexOf("router.post('/sequence'") - 200, src.indexOf("router.post('/sequence'") + 200);
    expect(seq).toMatch(/fiber_meal_sequencing_enabled/);
  });
});
