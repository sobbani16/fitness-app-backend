# Dependency Remediation — Phase 2

Method: smallest safe upgrade; no blind `npm audit fix --force`. Classifications
verified against lockfiles + GitHub Advisory DB.

## Backend — RESOLVED (0 high/critical, 2 moderate)

| Advisory | Package | Path | Resolution |
|---|---|---|---|
| GHSA-ggr8-5vv4-36mx (CVE-2026-40345, high) | deepmerge-ts 7.1.5 | prisma→@prisma/config | override `^8.0.2` |
| GHSA-7589-6fvf-x4pw (CVE-2026-121707, high) | effect 3.21.0 | prisma→@prisma/config | override `^3.22.1` |
| GHSA-g3hv-75wg-m249 (moderate) | minimatch | swagger-jsdoc→glob | override `^11.0.1` |

Prisma 7 evaluated and **rejected**: even @prisma/config@7.10.1 pins vulnerable
`effect@3.20.0` (prisma/orm#31125 open). Overrides achieve the same flag
clearance without a major migration. Prisma toolchain is CLI/config-load only —
not user-reachable runtime input.

Remaining (accepted): 2 moderate glob/minimatch under swagger-jsdoc — runs only
when `ENABLE_API_DOCS=true`; disabled in production.

Gate: `scripts/audit-gate.js` + `docs/security-audit/known-advisories.json`
(reviewed allowlist w/ id+reason+date) enforced in `.github/workflows/security.yml`.

## Web — RESOLVED (0 vulnerabilities, prod AND dev)

| Advisory | Package | Resolution |
|---|---|---|
| GHSA-mrhx-c7xc-m3w5 (CVE-2023-54404, high) | zod 3.24.1 | `^4.6.6` + @hookform/resolvers ^5 + react-hook-form ^7.55 (peer) |
| GHSA-pc58/7qx7/f3mh (moderate ×3) | next 15.5.28 | `15.5.29` |
| GHSA-6g55/r28c/fxqj/qx2v (high/moderate) | postcss | override+devDep `^8.5.23` |
| GHSA-7mvr-c777-76hp (CVE-2025-59288, high) | @playwright/test | `1.57.0` |
| vite/esbuild/tinypool/vitest (critical+high, dev) | vitest 2.1.8 | `^4.1.12` |

Side-fix: dashboard `Promise.all` destructure misaligned one slot — every panel
bound the wrong endpoint. Fixed; clears all 25 pre-existing TS errors. Build green.

## Mobile — PARTIAL (1 high risk-accepted, 13 moderate toolchain)

| Advisory | Package | Resolution |
|---|---|---|
| GHSA-g3hv-75wg-m249 | minimatch | override `^11.0.1` — resolved |
| GHSA-w3rx/5p2g (CVE-2025-71330/29, high) + 8 more | image-size 1.2.1 | **RISK-ACCEPTED** — see below |
| glob/xcode via @expo/* (moderate ×13) | expo toolchain | build-time only; resolved via Expo SDK upgrade track |

**image-size risk acceptance (reviewed):** metro@0.83.3 pins `image-size ^1.0.2`
and calls the v1 default export; v2 removes it → overriding breaks every image
asset bundle (verified in installed metro source). No patched 1.x exists.
Exploitability: bundler-only DoS requiring a malicious image asset inside the
repo — CI-controlled input, never shipped to devices. Resolution path: metro
0.87 drops image-size entirely → resolves organically with the next Expo SDK /
RN 0.87 upgrade (breaking, separate project). 673/673 tests + typecheck green.

## Admin — RESOLVED (0 vulnerabilities)

`npm audit fix` (semver-safe): axios 1.21.1 (~22 advisories incl. socket-hijack/
SSRF/ReDoS), vite 8.3.7 (dev-server RCE GHSA-p4f5-76q4-ffq7), plus transitive
fixes (brace-expansion, browserslist, react-router open-redirect/XSS, zod,
minimatch). Build + typecheck green.

## Posture

| Repo | high/crit prod | overall | Evidence |
|---|---|---|---|
| backend | **0** | 2 moderate (docs-only, gated) | `node scripts/audit-gate.js` → 0 unexpected |
| web | **0** | **0** | `npm audit` clean |
| mobile | 1 (image-size, build-time, risk-accepted) | 14 | review record above |
| admin | **0** | **0** | `npm audit` clean |
