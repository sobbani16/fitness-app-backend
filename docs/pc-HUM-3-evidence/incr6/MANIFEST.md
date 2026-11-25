# pc-HUM-3 increment 6 — Add-meal UI evidence manifest
Run: 2026-11-24 ~17:27–17:45 local, iPhone 17 Pro sim (iOS 26.4), dev client com.sobbani.fitnessappmobile,
Metro bundle from mobile checkout @ 1e4cc27, backend :4000 @ humai/dev-03-pc-HUM-3-fiber-validation (48bacb9), fitness_app dev DB, account fl-device-verify@syn.local.

| File | Evidence |
|---|---|
| lentils-preview-1serving.png | Preview card at 1 serving: "Number of servings 1 = 12 g total", Fiber 1.3 auto-computed, per-100g basis shown |
| lentils-12.5-servings.png | Quantity change: 12.5 servings → "= 150 g total", Fiber 16.1, macros rescaled (cal 528, P 36.9, C 95.1, F 1.7) |
| lentils-saved-alert.png | "Saved on this device · Brown lentils (dry) · 528 kcal. Server sync runs when connected." — offline-first save |
| milk-zero-preview.png | Milk low-fat "1 cup (246 g)": Fiber field explicit 0 (measured zero, not blank) |
| glucose-blank-fiber.png | GLUCOSE TABLETS, GRAPE "0.2 ONZ (4.5 g)": Fiber field blank, placeholder "Unknown if blank" |
| glucose-saved-alert.png | "Saved on this device · GLUCOSE TABLETS, GRAPE · 20 kcal" — entry later rejected server-side 400 Invalid serving (F-5) |
| dashboard-after-sync.png | Fiber card "Target 37 g · 20.9 g to go" after lentils+milk sync; glucose absent (outbox trap) |
