# pc-HUM-3 increment-7 evidence (iPhone 17 Pro sim, iOS 26.4, dev client, Metro @ 1e4cc27, backend :4000 fitness_app, 2026-11-24)

- `pchum3-today-list.png` — Food tab "Today's diary" listing task-owned entries (n3v5/n3v6) pre-cleanup; 🗑 control visible.
- `pchum3-del-confirm.png` — supported "Remove meal?" confirmation dialog used for device-side cleanup.
- `pchum3-restrict-card.png` — restricted profile rendered: "Target 14 g · 14 g to go · clinician review advised" + macro tile still "Target 30 g" (F-1 under restriction) + "Close the gap with food" suggestions rendered under `professional_review_required` (heuristic conflict).
- `pchum3-fix-details.png` — SyncStatusBanner details: "GLUCOSE TABLETS, GRAPE: Invalid serving" + `POST /food-logs · 400 validation · ref m-mwv9znqq-gt6zf360` (F-5 verbatim on device).
- `pchum3-missp-card2.png` — pull-refresh revealing "1 meal needs a fix before syncing" banner (orphaned rejected outbox op after diary delete).
- `pchum3-after-retry.png` — post-Retry state: issue persists; retried POST → 400 again; no server row recreated.
