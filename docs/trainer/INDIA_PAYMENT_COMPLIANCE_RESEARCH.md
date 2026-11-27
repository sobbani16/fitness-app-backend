# India Payment / KYC / Tax / Consumer-Protection Research (pc-HUM-143)

Compiled 2026-11-27 from primary sources (RBI circulars, GST Council notifications,
Razorpay merchant docs, Consumer Protection (E-Commerce) Rules 2020).
**This is engineering input, not legal/tax advice.** Every applicability verdict
marked NEEDS-PROFESSIONAL-REVIEW must be confirmed by a CA/legal counsel before
any real transaction. No unsupported claims are made anywhere below; uncertain
items are labeled uncertain.

## 1. Recurring payments — RBI e-mandate framework (VERIFIED, primary source)

Primary sources: RBI circulars CO.DPSS.POLC.No.S-518/02.14.003/2022-23 (Jun 2022),
S-882/02.14.003/2023-24 (Dec 2023), master direction S528/02-14-003/2024-25 (Aug 2024).

- First transaction under any e-mandate/standing instruction (cards, PPI, UPI)
  requires Additional Factor of Authentication (AFA).
- Subsequent recurring transactions up to ₹15,000 are AFA-exempt. The Dec 2023
  increase to ₹1,00,000 applies ONLY to mutual funds, insurance premiums, and
  credit card bill payments — **fitness coaching is NOT in that list**; ₹15,000
  is our ceiling for frictionless recurring charges.
- Pre-debit notification to the customer at least 24 hours before each charge
  is mandatory (Aug 2024 master direction reaffirms).
- **Applicability to us**: subscription packages with recurring billing above
  ₹15,000/period will hit per-transaction AFA friction in India. Design impact:
  keep subscription price points at or under ₹15,000/period OR document the
  AFA step in UX; pre-debit notification duty falls on the issuer/processor
  chain but our provider integration must not suppress it. NEEDS-PROVIDER-CONFIRM:
  whether the chosen aggregator (Razorpay/Stripe-in-India) handles pre-debit
  notification and e-mandate registration natively — do not build recurring
  billing until confirmed in the provider's India docs.

## 2. GST on coaching services (VERIFIED framework; RATE AMBIGUOUS — flagged honestly)

Sources: 56th GST Council outcomes (Sep 2025), Notification 15/2025-Central Tax (Rate),
tax-practitioner literature cross-checked for consistency.

- Coaching/training services that do not lead to a government-recognized degree
  are taxable services — no education exemption applies to us.
- From 22 Sep 2025, "physical well-being services" (gym, health club, fitness
  centre, yoga — SAC 999723) attract **5% GST without ITC** (mandatory, cannot
  opt for 18%+ITC).
- **THE AMBIGUITY THAT MATTERS**: multiple practitioner sources state online /
  app-delivered coaching "may be classified as digital/online services, not
  physical well-being" — which would mean **18%**, not 5%. No authoritative
  ruling found settling this for app-only remote fitness coaching. Our product
  is exactly that case. HONEST POSITION: rate uncertain between 5% and 18%;
  do not encode either into pricing logic as final. NEEDS-CA-RULING before
  real transactions; pricing config must keep GST treatment a per-invoice
  parameter, never a hardcoded constant.
- Registration threshold: aggregate turnover ₹20 lakh (₹10 lakh special-category
  states); voluntary earlier registration possible. Below threshold, GST
  registration is not mandatory — but marketplace structure (platform + trainer
  suppliers) changes WHO owes what: trainer-as-supplier vs platform-as-supplier
  is a structural tax decision. NEEDS-CA-RULING.
- OIDAR relevance: if any non-India entity supplies to Indian consumers, IGST
  OIDAR rules attach — flagged for completeness, likely N/A at launch.

## 3. KYC / merchant onboarding (VERIFIED at provider level — Razorpay documented)

Primary source: Razorpay merchant + sub-merchant onboarding docs.

- Marketplace payouts to trainers imply trainers are sub-merchants or payout
  beneficiaries. Razorpay sub-merchant activation requires KYC verification
  BEFORE settlements are enabled — payments can be accepted in "Instantly
  Activated" state but **settlements stay disabled until KYC verification
  completes**. This is a hard operational gate for trainer payouts.
- Individual/unregistered trainers: PAN + bank account + IFSC mandatory;
  address proof via CKYC/Aadhaar/passport paths.
- **Applicability to us**: trainer payout onboarding must collect PAN, bank
  account, IFSC at minimum; payout features must gate on provider-side KYC
  status, not just our own verification. Our current payout skeleton has no
  KYC-state gate — recorded as a required integration point, not yet built.
  NEEDS-PROVIDER-INTEGRATION when real provider selected.

## 4. Consumer protection (VERIFIED framework — E-Commerce Rules 2020)

Primary source: Consumer Protection (E-Commerce) Rules, 2020 under the
Consumer Protection Act, 2019.

- Applies to all services bought over digital networks, marketplace models
  explicitly included — we are an e-commerce entity under the rules.
- Unfair-trade-practice prohibitions apply to marketplace platforms including
  manipulation of consumer reviews — aligns with our verified-participant-only
  review design (no incentivized/required favorable reviews, implemented in
  the review surface: one review per trainer-client pair, published-only reads,
  separated moderation).
- Grievance redressal: e-commerce entities must appoint a grievance officer and
  publish contact details; ack within 48 hours, resolve within one month
  (per the Rules' text). NEEDS-LEGAL-REVIEW for exact operational obligations;
  support contact surface exists in app config but grievance-officer designation
  is an organizational decision, not code.
- Refund/cancellation: the rules require clear display of refund terms; no
  statutory cooling-off for services was found in the primary text — do NOT
  claim one exists. Our refund implementation (trainer-initiated, atomic
  claim-then-provider-call) is stricter than the floor, which is acceptable.

## 5. What this means for build order (honest engineering summary)

1. Mock-provider infrastructure is correct for sandbox development and is
   production-blocked + test-pinned — real-provider selection is the gate.
2. Before ANY real transaction: CA ruling on the 5%-vs-18% GST classification
   (the single biggest financial-compliance unknown), provider confirmation of
   e-mandate/pre-debit handling, legal review of grievance-officer duties.
3. Trainer payout activation requires provider-side KYC state integration —
   cannot be self-certified.
4. Nothing in this document authorizes real charges. Sandbox-only testing
   continues; no real charges/refunds/payouts have been or will be executed
   without explicit founder approval and professional signoff.
