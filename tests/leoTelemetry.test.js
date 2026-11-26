// Redaction boundary tests for Leo telemetry (pc-HUM-97).
// Synthetic catalog events only — the canonical P30 event catalog is PENDING
// (spec doc missing); these tests prove the boundary mechanics, not the
// product event list. Every assertion is about what REACHES THE SINK.

const { createLeoTelemetry, leoTelemetry } = require('../src/services/leoTelemetry');

function sink() {
  const lines = [];
  return {
    lines,
    logger: { info: (line) => lines.push(line), warn: (line) => lines.push(line) },
    parsed: () => lines.map((l) => JSON.parse(l)),
  };
}

// Synthetic stand-in events — NOT the P30 catalog.
const CATALOG = {
  'leo.capture_committed': {
    numerics: { durationMs: { min: 1, max: 120000 }, frameCount: { min: 0, max: 100000 } },
    categoricals: { outcome: ['committed', 'no_speech', 'cancelled', 'error'] },
  },
  'leo.tts_served': {
    numerics: { charCount: { min: 1, max: 600 } },
    categoricals: { voice: ['alloy'], provider: ['openai'] },
  },
};

function makeTel() {
  const s = sink();
  return { tel: createLeoTelemetry({ catalog: CATALOG, logger: s.logger }), sink: s };
}

const CTX = {
  correlationId: 'corr-abc12345',
  sessionId: 'sess-xyz-98765',
  requestId: 'req-qwertyuiop',
};

describe('leoTelemetry — valid metadata reaches the sink', () => {
  test('approved event with valid context + fields logs exactly the approved shape', () => {
    const { tel, sink: s } = makeTel();
    const out = tel.log('leo.capture_committed', CTX, { durationMs: 4200, frameCount: 132, outcome: 'committed' });
    expect(s.lines).toHaveLength(1);
    expect(JSON.parse(s.lines[0])).toEqual({
      event: 'leo.capture_committed',
      correlationId: 'corr-abc12345',
      sessionId: 'sess-xyz-98765',
      requestId: 'req-qwertyuiop',
      durationMs: 4200,
      frameCount: 132,
      outcome: 'committed',
    });
    expect(out).not.toBeNull();
  });

  test('sink receives a JSON string, not the caller object', () => {
    const { tel, sink: s } = makeTel();
    const payload = { durationMs: 1000 };
    tel.log('leo.capture_committed', CTX, payload);
    expect(typeof s.lines[0]).toBe('string');
    // mutating the caller payload after logging cannot affect what was logged
    payload.durationMs = 99999;
    expect(JSON.parse(s.lines[0]).durationMs).toBe(1000);
  });

  test('events with partial context still log, minus the missing identifiers', () => {
    const { tel, sink: s } = makeTel();
    tel.log('leo.tts_served', { correlationId: CTX.correlationId }, { charCount: 120, voice: 'alloy', provider: 'openai' });
    const line = JSON.parse(s.lines[0]);
    expect(line.correlationId).toBe('corr-abc12345');
    expect(line.sessionId).toBeUndefined();
    expect(line.requestId).toBeUndefined();
  });
});

describe('leoTelemetry — forbidden content never reaches the sink', () => {
  test('arbitrary string fields are omitted entirely', () => {
    const { tel, sink: s } = makeTel();
    tel.log('leo.capture_committed', CTX, {
      durationMs: 3000,
      transcript: 'the user said something private',   // forbidden content
      note: 'free text',                                 // arbitrary string
      userId: 'user-identity-leak',                      // identity-ish string
    });
    const line = JSON.parse(s.lines[0]);
    expect(line.durationMs).toBe(3000);
    expect(line.transcript).toBeUndefined();
    expect(line.note).toBeUndefined();
    expect(line.userId).toBeUndefined();
    expect(Object.keys(line).sort()).toEqual(['correlationId', 'durationMs', 'event', 'requestId', 'sessionId']);
  });

  test('tokens, audio refs, health data and raw errors are omitted', () => {
    const { tel, sink: s } = makeTel();
    tel.log('leo.capture_committed', CTX, {
      durationMs: 1500,
      token: 'sk-abc123secret',
      audioRef: 's3://bucket/private/audio.m4a',
      healthCondition: 'type-2-diabetes',
      error: new Error('sqlite error: SELECT * FROM users WHERE password_hash = ...'),
    });
    const line = JSON.parse(s.lines[0]);
    for (const k of ['token', 'audioRef', 'healthCondition', 'error']) expect(line[k]).toBeUndefined();
    expect(s.lines[0]).not.toMatch(/sk-abc|audio\.m4a|diabetes|password/);
  });

  test('nested objects and arrays are omitted even under approved-looking keys', () => {
    const { tel, sink: s } = makeTel();
    tel.log('leo.capture_committed', CTX, {
      durationMs: { value: 3000 },          // object masquerading as numeric
      frameCount: [1, 2, 3],                // array
      outcome: { state: 'committed' },      // object masquerading as categorical
      nested: { deep: { deeper: 'secret' } },
    });
    const line = JSON.parse(s.lines[0]);
    expect(line.durationMs).toBeUndefined();
    expect(line.frameCount).toBeUndefined();
    expect(line.outcome).toBeUndefined();
    expect(line.nested).toBeUndefined();
    expect(s.lines[0]).not.toMatch(/secret|3000/);
  });

  test('identifier fields carrying payload strings are dropped by pattern validation', () => {
    const { tel, sink: s } = makeTel();
    tel.log('leo.capture_committed', {
      correlationId: 'user@example.com is my email',   // fails identifier shape
      sessionId: 'x',                                   // too short
      requestId: 'valid-request-id-123',
    }, { durationMs: 900 });
    const line = JSON.parse(s.lines[0]);
    expect(line.correlationId).toBeUndefined();
    expect(line.sessionId).toBeUndefined();
    expect(line.requestId).toBe('valid-request-id-123');
    expect(s.lines[0]).not.toMatch(/example\.com/);
  });
});

describe('leoTelemetry — malformed values in allowed fields', () => {
  test('non-finite numerics are omitted (NaN, Infinity, strings)', () => {
    const { tel, sink: s } = makeTel();
    tel.log('leo.capture_committed', CTX, { durationMs: NaN, frameCount: Infinity, outcome: 'committed' });
    let line = JSON.parse(s.lines[0]);
    expect(line.durationMs).toBeUndefined();
    expect(line.frameCount).toBeUndefined();
    expect(line.outcome).toBe('committed'); // valid sibling field survives

    s.lines.length = 0;
    tel.log('leo.capture_committed', CTX, { durationMs: '4200' }); // numeric-as-string
    line = JSON.parse(s.lines[0]);
    expect(line.durationMs).toBeUndefined();
  });

  test('out-of-bounds numerics are omitted', () => {
    const { tel, sink: s } = makeTel();
    tel.log('leo.capture_committed', CTX, { durationMs: 120001, frameCount: -1 });
    const line = JSON.parse(s.lines[0]);
    expect(line.durationMs).toBeUndefined();
    expect(line.frameCount).toBeUndefined();
  });

  test('off-enum categorical values are omitted', () => {
    const { tel, sink: s } = makeTel();
    tel.log('leo.capture_committed', CTX, { durationMs: 800, outcome: 'committed; DROP TABLE users' });
    const line = JSON.parse(s.lines[0]);
    expect(line.outcome).toBeUndefined();
    expect(line.durationMs).toBe(800);
    expect(s.lines[0]).not.toMatch(/DROP TABLE/);
  });
});

describe('leoTelemetry — unknown events are rejected', () => {
  test('unknown event names never reach the sink', () => {
    const { tel, sink: s } = makeTel();
    const out = tel.log('leo.transcript_content', CTX, { durationMs: 1000 });
    expect(out).toBeNull();
    expect(s.lines).toHaveLength(0);
    expect(tel.log('random.garbage', CTX, {})).toBeNull();
    expect(tel.log('', CTX, {})).toBeNull();
    expect(tel.log(undefined, CTX, {})).toBeNull();
    expect(s.lines).toHaveLength(0);
  });

  test('the shipped instance has an empty catalog and rejects everything (P30 pending)', () => {
    // No sink injection on the module-level instance — prove rejection via return value.
    expect(leoTelemetry.log('leo.capture_committed', CTX, { durationMs: 1000 })).toBeNull();
    expect(Object.keys(leoTelemetry.catalog)).toHaveLength(0);
  });
});

describe('leoTelemetry — catalog validation', () => {
  test('rejects malformed catalogs at construction', () => {
    expect(() => createLeoTelemetry({ catalog: null })).toThrow();
    expect(() => createLeoTelemetry({ catalog: { 'Bad Name!': {} } })).toThrow();
    expect(() => createLeoTelemetry({ catalog: { 'ok.event': { categoricals: { f: 'not-an-array' } } } })).toThrow();
    expect(() => createLeoTelemetry({ catalog: { 'ok.event': { categoricals: { f: [] } } } })).toThrow();
  });

  test('catalog is frozen against post-construction widening', () => {
    const tel = createLeoTelemetry({ catalog: CATALOG, logger: sink().logger });
    expect(Object.isFrozen(tel.catalog)).toBe(true);
  });
});
