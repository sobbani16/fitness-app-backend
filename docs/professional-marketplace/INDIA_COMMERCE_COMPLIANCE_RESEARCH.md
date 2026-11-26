# India commerce compliance research — pre-legal-review basis (pc-HUM-143)

**Status: research documentation, NOT legal advice, NOT a compliance claim.**
Spec: paperclip `docs/programs/professional-marketplace.md` @ `00c50f0`,
PHASE-10/PHASE-11 — "Research Indian payment/KYC/tax/consumer-protection/
app-store requirements before real transactions. Document applicability — no
unsupported claims." Every item below is marked with its verification state.
**Nothing in this document authorizes enabling real transactions.** Counsel
review is a named prerequisite in the needs_human register.

## 1. Payments

### 1.1 RBI e-mandate / recurring card payment rules
Research basis: RBI circulars on processing of e-mandates for recurring
online transactions (2019 framework, extended through 2021; cap raised to
₹15,000 per transaction without additional factor authentication, later
revisions exist). Applicability: any subscription-kind coaching package
(our `TrainerCoachingPackage.kind = 'subscription'`) billed to Indian cards
must flow through a provider that implements e-mandate registration,
pre-debit notification (24h+), and the AFA opt-in above the cap. **Verify
current cap and circular versions with the acquiring provider before any
live subscription charge.** Unverified-in-repo: exact current monetary cap.

### 1.2 Card-on-file tokenization
RBI prohibited merchants and payment aggregators from storing actual card
numbers (device tokenization / card-on-file tokenization regime, enforcement
from 2022-10). Applicability: our payment flow must never persist raw card
data; the server-side purchase ledger stores only provider references
(`TrainerPurchase.providerRef`) — consistent by design. Provider must be
RBI-compliant for tokenization. State: architectural conformance verified in
code; provider certification NOT verified (requires vendor documentation).

### 1.3 Payment aggregators — licensing
Payment aggregators operating in India require RBI authorization (PAA
framework, 2020+). Applicability: provider selection must be restricted to
RBI-authorized aggregators (e.g., entities publicly listed by RBI as
authorized). State: NOT SELECTED — mock provider only; no production provider
is configured anywhere in this codebase.

### 1.4 Marketplace/intermediary settlement
Coaching marketplaces paying out to professionals implicate aggregation +
nodal/escrow account norms (RBI directions on opening and operation of
accounts for payment intermediaries). Payout flows (`TrainerPayout` model
exists, execution NOT built) must route through compliant settlement
mechanisms when built. State: documented requirement, execution unbuilt —
sandbox-only.

## 2. KYC / identity

- Professionals receiving payouts are payees of a marketplace: the payout
  provider will impose its own KYC (PAN, bank account verification per RBI
  KYC master direction as amended). Applicability: payout onboarding must
  collect PAN + bank details through the provider's KYC surface, never
  stored as raw documents in our DB. State: requirement documented; payout
  execution unbuilt.
- No biometric/facial-recognition identity verification for progress photos
  — spec-prohibited regardless of vendor offerings.

## 3. Tax

- GST: online coaching/fitness services supplied through an electronic
  commerce operator implicate GST registration, invoicing (tax invoice with
  GSTIN where applicable), place-of-supply rules, and potentially TCS-style
  collection obligations depending on operator/seller structuring. Rates and
  thresholds change; **no rate is asserted in this document**. State:
  REQUIRES counsel + a chartered accountant before any real charge. The
  purchase ledger stores `amountCents`/`currency` without tax decomposition —
  tax-inclusive/exclusive handling is an open design decision for the
  finance implementation, documented here as blocking for live transactions.
- Professional income payouts: TDS applicability depends on the legal
  relationship structuring (independent professionals vs. service through
  operator). State: unresolved structuring decision — needs_human.

## 4. Consumer protection

- Consumer Protection Act 2019 + E-Commerce Rules 2020 (as amended):
  marketplace operators have obligations around seller/price transparency,
  grievance officer appointment, no unfair trade practices, clear
  cancellation/refund terms, and prohibition of manipulating reviews or
  search ranking without disclosure. Applicability: reviews system (this
  branch) implements verified-participant-only reviews, no favorable-review
  requirement, separate professional responses, moderation with reasons —
  aligned with the anti-manipulation posture. Refund bounds implemented in
  commerce service (partial refunds, duplicate protection). Grievance officer
  appointment and published terms are operational/legal tasks — NOT done.
- DPDP Act 2023: consent, notice, data-principal rights for personal data;
  health data of clients is sensitive-adjacent in practice even though the
  Act's final rules' categorization must be verified against notified rules.
  Commencement/notification state MUST be re-verified at implementation time
  — this document does not assert the current notification status.

## 5. App-store requirements

- Apple App Store / Google Play: digital coaching services purchased and
  consumed inside the app generally implicate in-app-purchase policy review;
  the marketplace exception analysis (services consumed outside the app vs.
  digital) is fact-specific and must be decided before enabling real mobile
  payments. State: unresolved — documented decision required before any
  store-submitted build with live payments. Multi-currency/INR pricing in
  the packages model is currency-code-flexible by design but storefront
  pricing mechanics are undecided.

## 6. What this means for merge readiness

Live transactions require, at minimum: (a) counsel sign-off on 1-5 above,
(b) RBI-authorized provider selection + contract, (c) tax structuring
decision, (d) grievance officer + published consumer terms, (e) app-store
IAP decision. Until then: mock provider only, sandbox-only testing, and the
existing production-blocking gate on the mock provider (`payments/provider.js`
fail-closed in production) MUST remain intact — verified by existing
`trainerCommerce` tests.
