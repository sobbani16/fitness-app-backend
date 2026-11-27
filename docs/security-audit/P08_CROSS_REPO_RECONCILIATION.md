# P08 cross-repo reconciliation addendum — web/admin/mobile (2026-11-27, pc-HUM-77)

Read-only sweep of CURRENT tracked state (no deep history — human-gated). Values never
inspected or reproduced; paths and posture only. No credentials used for anything.

## Tracked-file sweep results

| repo | tracked secret-pattern files at HEAD | verdict |
|---|---|---|
| fitness-app-web | **zero** (`git ls-files` filtered .env/.pem/.key/.p12/.keystore/credential/secret, excluding examples/tests/docs) | clean at HEAD |
| fitness-app-admin | **zero** | clean at HEAD |
| fitness-app-mobile | **zero** | clean at HEAD |

No live exposures in tracked files → no class-1/class-2 findings, no rotation triggers from
this sweep. Deep-history exposure verification remains needs-human (already filed).

## fitness-app-admin `.env` untrack verification (commit `49bc5cd`)

- Current tree: `.env` NOT tracked — `git ls-files` empty (verified).
- `.env` present on disk (35 bytes) and correctly untracked — the untrack commit achieved
  its intent at HEAD.
- Whether the previously-tracked revision contained live-format secrets is a DEEP-HISTORY
  question — remains under the existing human-gated history-scan ask, now with a concrete
  repository+commit pointer (class 7 unverifiable → treat as class 2 for safety per framework).

## Future-commit scanning posture matrix

| repo | CI secret-scanning | pinning | pre-commit | gitignore env coverage |
|---|---|---|---|---|
| backend | **yes** — `.github/workflows/security.yml` + `test.yml` (gitleaks) | **SHA-pinned** (pc-HUM-38) | none | solid: `.env`, `.env.*`, `!.env.example`, `.env.generated` |
| mobile | **yes** — `.github/workflows/mobile-ci.yml` `secret-scan` job | **FLOATING TAG `gitleaks-action@v2.3.9`** — supply-chain gap | none | **gap**: `.env` exact + `.env*.local` — `.env.production` / `.env.staging` shapes NOT covered |
| web | **none — no `.github/workflows/` exists at all** | n/a | none | **gap**: `.env` + `.env.local` + `.env*.local` — `.env.production` shape NOT covered |
| admin | **none — no `.github/` exists at all** | n/a | none | solid: `.env`, `.env.*`, `!.env.example` |

## Docker / EAS artifact excludes

- **Docker**: no Dockerfile or .dockerignore in ANY of the four repos — class not-applicable,
  zero artifact surface.
- **EAS (mobile)**: `.easignore` exists and covers `*.key` + `.env*.local` — but the same
  `.env.production`-shape gap applies: a production env file would ship into EAS build
  artifacts if created. `eas.json` exists (6 env references — build-time env wiring present).

## Findings classification

| finding | class | severity | owner lane |
|---|---|---|---|
| mobile `.env.production`-shape gitignore+easignore gap | class 7 preventive-gap | medium — no exposure exists; future-commit path open | pc-HUM-76 / mobile lane |
| web identical gitignore gap + NO CI scanning | class 7 preventive-gap | **high** — nothing prevents a future secret commit in web | pc-HUM-74 / web lane |
| admin NO CI scanning (gitignore solid) | class 7 preventive-gap | medium — gitignore is the only barrier | pc-HUM-74 / admin lane |
| mobile gitleaks floating tag (backend is SHA-pinned) | supply-chain posture | low-medium | pc-HUM-76 / mobile lane |
| admin historical `.env` tracked-then-untracked | class 7 unverifiable | unknown — deep-history scan already needs-human | owner decision #history-scan |

## Discipline notes

- No file CONTENTS of candidate secret files were inspected — `ls` sizes and git index
  state only. The 35-byte admin `.env` was never opened.
- No repo was modified: web/admin/mobile are other lanes' trees; findings documented here
  for cross-posting, remediation belongs to lane owners.
- Backend posture verified strongest: SHA-pinned scanning + complete gitignore — the model
  other repos should converge toward (documented, not imposed).
