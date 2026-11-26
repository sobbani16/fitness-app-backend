// P5: landmark→angle extraction against the P4 exercise definitions.
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let probeN = 0;
const probe = (prog) => {
  const f = `/tmp/hum100-probe-${process.pid}-${probeN++}.py`;
  fs.writeFileSync(f, prog);
  return execSync(`python3 ${f}`, { cwd: path.join(__dirname, '..') }).toString().trim();
};

describe('feature extraction (P5)', () => {
  it('computes a right angle correctly', () => {
    const out = probe(
      'import sys; sys.path.insert(0,"pose/training"); from features import angle_degrees; ' +
      'print(round(angle_degrees({"x":1,"y":0},{"x":0,"y":0},{"x":0,"y":1}), 2))'
    );
    expect(out).toBe('90.0');
  });

  it('straight leg reads ~180 degrees', () => {
    const out = probe(
      'import sys; sys.path.insert(0,"pose/training"); from features import angle_degrees; ' +
      'print(round(angle_degrees({"x":0,"y":1},{"x":0,"y":0},{"x":0,"y":-1}), 1))'
    );
    expect(out).toBe('180.0');
  });

  it('extract_sequence tracks the squat knee joint across frames and flags occlusion', () => {
    const frames = JSON.stringify([
      { left_hip: { x: 0, y: 1, visibility: 0.99 }, left_knee: { x: 0, y: 0.5, visibility: 0.99 }, left_ankle: { x: 0, y: 0, visibility: 0.99 },
        right_hip: { x: 0.1, y: 1, visibility: 0.99 }, right_knee: { x: 0.1, y: 0.5, visibility: 0.99 }, right_ankle: { x: 0.1, y: 0, visibility: 0.99 },
        left_shoulder: { x: 0, y: 1.4, visibility: 0.99 }, right_shoulder: { x: 0.1, y: 1.4, visibility: 0.99 } },
      { left_hip: { x: 0, y: 1, visibility: 0.99 }, left_knee: { x: 0, y: 0.5, visibility: 0.2 }, left_ankle: { x: 0, y: 0, visibility: 0.99 },
        right_hip: { x: 0.1, y: 1, visibility: 0.99 }, right_knee: { x: 0.1, y: 0.5, visibility: 0.99 }, right_ankle: { x: 0.1, y: 0, visibility: 0.99 },
        left_shoulder: { x: 0, y: 1.4, visibility: 0.99 }, right_shoulder: { x: 0.1, y: 1.4, visibility: 0.99 } },
    ]);
    fs.writeFileSync('/tmp/hum100-frames.json', frames);
    const out = probe(
      'import sys,json; sys.path.insert(0,"pose/training"); from features import extract_sequence; ' +
      'r=extract_sequence(json.load(open("/tmp/hum100-frames.json")),"squat"); ' +
      'k=r["joints"]["knee"]; print(len(k), k[0]["uncertain"], round(k[0]["angle"] or 0,1))'
    );
    const [n, unc, ang] = out.split(' ');
    expect(n).toBe('2');
    expect(parseFloat(ang)).toBeCloseTo(180, 0);
  });

  it('invisible landmarks yield angle None marked uncertain — never fabricated', () => {
    const out = probe(
      'import sys; sys.path.insert(0,"pose/training"); from features import resolve_landmark; ' +
      'print(resolve_landmark({"left_knee":{"x":0,"y":0,"visibility":0.1}}, "knee"))'
    );
    expect(out).toBe('None');
  });

  it('rejects unknown exercise ids', () => {
    let failed = false;
    try {
      probe('import sys; sys.path.insert(0,"pose/training"); from features import load_exercise; load_exercise("nope")');
    } catch { failed = true; }
    expect(failed).toBe(true);
  });
});
