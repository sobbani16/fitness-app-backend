#!/usr/bin/env node
// Expected-head-SHA guard (release mechanics, pc-HUM-63). Before merging or
// deploying a release branch, verify the candidate head is EXACTLY the revision
// that was tested, and that the target base is an ancestor (no force-updated
// branch, no untested commits on top). Read-only git inspection.
//
// Usage:
//   node scripts/check-release-head.js --branch <ref> --expect <sha> [--base origin/main]
// Exit 1 with a named reason on any mismatch. Never prints secret material.
const { execSync } = require('child_process');

function git(args, cwd = process.cwd()) {
  return execSync(`git ${args}`, { cwd, encoding: 'utf8' }).trim();
}

function checkReleaseHead({ branch, expect, base = 'origin/main', cwd = process.cwd() }) {
  const problems = [];
  if (!/^[0-9a-f]{40}$/.test(expect || '')) return { ok: false, problems: ['--expect must be a full 40-char SHA'] };
  let head;
  try { head = git(`rev-parse ${branch}`, cwd); } catch { return { ok: false, problems: [`branch ${branch} unresolvable`] }; }
  if (head !== expect) problems.push(`head mismatch: ${branch} is ${head.slice(0, 10)} but tested SHA is ${expect.slice(0, 10)} — the tested revision is not what would merge`);
  try {
    git(`merge-base --is-ancestor ${base} ${branch}`, cwd);
  } catch {
    problems.push(`${base} is not an ancestor of ${branch} — branch is behind; merge would not be fast-forwardable clean or content is untested in combination`);
  }
  let dirty = '';
  try { dirty = git('status --short', cwd); } catch { /* non-worktree invocation */ }
  if (dirty) problems.push(`worktree has uncommitted changes — release evidence must be tree-clean`);
  return { ok: problems.length === 0, problems, head };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
  if (!opt.branch || !opt.expect) { console.error('usage: --branch <ref> --expect <sha> [--base <ref>]'); process.exit(2); }
  const { ok, problems, head } = checkReleaseHead(opt);
  if (ok) console.log(`release head verified: ${head.slice(0, 12)} matches tested SHA; ${opt.base || 'origin/main'} is ancestor; tree clean`);
  for (const p of problems) console.log(`FAIL: ${p}`);
  process.exit(ok ? 0 : 1);
}
module.exports = { checkReleaseHead };
