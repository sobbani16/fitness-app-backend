// pc-HUM-101 — CI detection for the exercise-intelligence profile artifact.
// Runs in jest CI: fails the pipeline when profiles go missing, structurally
// incomplete, or honesty-regressed — without needing a database.
const artifact = require('../docs/exercise-intelligence/exercise-profiles.v1.json');

const REQUIRED_SECTIONS = ['identity', 'classification', 'movementCharacteristics', 'poseRequirements', 'intelligenceConfig', 'safety', 'validation', 'capability'];

describe('exercise-intelligence profile artifact — CI detection', () => {
  const profiles = artifact.profiles || [];

  it('artifact is non-empty and count-consistent', () => {
    expect(profiles.length).toBeGreaterThan(0);
    expect(artifact.count).toBe(profiles.length);
  });

  it('every exercise ID has exactly one profile — no missing, no duplicates', () => {
    const seen = new Set();
    const dupes = [];
    for (const p of profiles) {
      if (seen.has(p.exerciseId)) dupes.push(p.exerciseId);
      seen.add(p.exerciseId);
      expect(typeof p.exerciseId).toBe('string');
      expect(p.exerciseId.length).toBeGreaterThan(0);
    }
    expect(dupes).toEqual([]);
  });

  it('every profile carries all required intelligence sections', () => {
    const incomplete = profiles.filter((p) => REQUIRED_SECTIONS.some((s) => p[s] == null));
    expect(incomplete.map((p) => p.exerciseId)).toEqual([]);
  });

  it('honesty: no profile claims ML/camera validation — capability levels are evidence-derived', () => {
    for (const p of profiles) {
      expect(p.capability.level).toBe(0); // manual tracking until evidence exists
      const blob = JSON.stringify(p).toLowerCase();
      expect(blob).not.toMatch(/ml.validated|ml-validated/);
      expect(blob).not.toMatch(/"validated":\s*true/);
    }
  });

  it('pose requirements record honest absence — never aspirational capability', () => {
    for (const p of profiles) {
      expect(p.poseRequirements.status).toBe('not_specified_no_pipeline');
      expect(p.poseRequirements.requiredLandmarks).toEqual([]);
    }
  });

  it('manual tracking always functional — level 0 label, zero validated automation claimed', () => {
    for (const p of profiles) {
      expect(p.capability.label).toBe('manual_tracking');
      expect(p.capability.validatedCapabilities).toEqual([]); // nothing validated without evidence
      expect(p.capability.unsupportedCapabilities.length).toBeGreaterThan(0); // honest about what's absent
      expect(p.validation.profileReviewStatus).toBe('auto_generated_unreviewed'); // existence ≠ review
    }
  });

  it('profile version is pinned and uniform — versioned intelligence per card', () => {
    expect(artifact.profileVersion).toMatch(/^exercise-intel-v\d+$/);
    const versions = new Set(profiles.map((p) => p.profileVersion));
    expect(versions.size).toBe(1);
    expect([...versions][0]).toBe(artifact.profileVersion);
  });
});
