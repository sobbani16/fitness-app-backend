# Numeric regression — summary
Root cause: unbounded serving-qty input (not a scaler defect). 225 servings × 32 g = 7200 g → protein 936 / carbs 2952 / fat 302.4 / fiber 504 exactly = per100 × 72.
Fix: portionGuard clamp (≤5000 g) at both entry points; Keyboard.dismiss() on save; save cap aligned.
Tests: 14/14 in foodLoggingPortions.test.ts; typecheck clean.
