# Knowledge Academy, Super Admin & Modular Entitlements

## Surfaces

| Surface | Mount | Access |
|---|---|---|
| Member academy | `GET /academy/*` | authenticated member; published content only |
| Editorial | `/editorial/*` | ACADEMY_AUTHOR / ACADEMY_REVIEW / ACADEMY_PUBLISH / MANAGE_REVIEWERS |
| Super Admin | `/super-admin/*` + `/editorial/*` | SUPER_ADMIN_PANEL permission + scoped perms per route |
| Web member UX | `/learn`, `/learn/:slug`, `/learn/saved`, `/learn/faq/:id` | member session |
| Web control center | `/super-admin/*` (workspace `super`) | SUPER_ADMIN_PANEL |
| Mobile | `Learn`, `LearnArticle` screens + Dashboard shortcut | `knowledgeAcademyEnabled` flag |

## Data model (migration `academy_entitlements`)

ResearchSource (stable key doi:/pmid:/url:), KnowledgeArticle (slug,
publishedRevisionId — immutable pointer), KnowledgeArticleRevision (versioned
content + verdict + certainty + rationale, frozen at approval), ArticleEvidence,
ArticleReview, ReviewerProfile, EditorialSchedule (publishKey unique —
idempotency), PublicationEvent (scheduleId unique), KnowledgeFAQ (sourceKeys
reuses ResearchSource), KnowledgeSavedItem, KnowledgeQuestionSuggestion,
ContentCorrection, MembershipModule/Package, UserEntitlement,
EntitlementEvent (providerEventId unique — webhook idempotency),
CoachingPreference.

## Workflow

draft → researching → ready_for_review → (approved → scheduled → published |
changes_requested → draft) ; published → correction_required → re-review →
re-publish. Withdraw → retracted. Approval freezes the revision; edits on
published articles create a NEW revision — v1 stays public until v2 is
approved + republished. Authors can never review their own article (403).
Clinical-scope reviews require ACADEMY_CLINICAL_REVIEW.

## Publishing engine

`scripts/weekly-publish.js` — picks due scheduled slots, revalidates
(approved immutable revision, resolvable refs, no open corrections),
publishes once (PublicationEvent.scheduleId unique), fans out ONE
`weekly_education` notification to users with WEEKLY_FITNESS_EDUCATION
enabled (deduped via deep-link in body). Blocked weeks mark the slot
`blocked` + notify EDITOR/SUPER_ADMIN roles — never fake an edition.
Cron: `railway.json` deploy.cronJobs → add `17 9 * * 0 node scripts/weekly-publish.js`
when enabling production.

## Entitlement engine

`src/lib/entitlements.js` — `canAccessFeature(userId, featureKey)` +
`requireEntitlement(featureKey)` middleware. ENTITLEMENT_MODE: `shadow`
(default — computes, never denies) → `enforce` (402 on missing module).
FREE_CORE implicit for all users. Role ≠ entitlement ≠ flag ≠ consent —
each checked independently.

## Super Admin bootstrap

`node scripts/grant-super-admin.js <email> --confirm` — grants SUPER_ADMIN
role (+ SUPER_ADMIN_PANEL permission via RBAC seed). Revoke with `--revoke`.
No HTTP grant path exists — prevents privilege escalation via the API.

## Feature flags

`knowledge_academy_enabled` (group education), `modular_entitlements_enabled`
(group billing) — registry entries; env overrides FF_KNOWLEDGE_ACADEMY_ENABLED
/ FF_MODULAR_ENTITLEMENTS_ENABLED.

## Verified

tests/academy.test.js — 6/6: member denial, source→draft→evidence→submit→
review→approve, self-review blocked, immutable publish + idempotent rerun,
published-content revision safety, entitlement grant/revoke, super-admin
denials. Full suite 798/798.
