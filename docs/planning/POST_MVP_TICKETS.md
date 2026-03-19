# Post-MVP Execution Tickets

This is the execution backlog for roadmap phases 6 through 11.

Ticket status values:
- `todo`
- `in_progress`
- `done`
- `blocked`

## Sequencing Rules

1. Complete Phase 6.5 (accounts + ownership) before starting Phase 11 cloud sync work.
2. Complete schema and API tickets before UI tickets in each phase.
3. Keep one migration-focused ticket per PR where possible.
4. Start Phase 6.6 (shared households) only after open 6.5 tickets are complete.
5. Complete Phase 6.7 auth hardening before production GA/public launch.

## Active Queue (Current)

1. `8.6-02` Deterministic Query Normalizer + Subject Canonicalization (`in_progress`) — depends on `8.6-01`
2. `8.6-03` Real-Query Regression Set + Lookup Evaluation (`todo`) — depends on `8.6-02`
3. `8.6-04` Pinecone Retrieval Tuning + Query/Result Cache Strategy (`todo`) — depends on `8.6-02`
4. `10.5-03` Frontend Onboarding + Empty States (`todo`) — depends on `10.5-02`
5. `10.5-04` Frontend Accessibility + Keyboard Navigation (`todo`) — depends on `10.5-02`
6. `11-02` Shared API Client + Auth Integration (`todo`) — depends on `11-01`

## Security Queue (Auth Hardening)

1. `6.7-01` Email Verification Schema + Verification API (`done`) — depends on `6.5-03`
2. `6.7-02` Transactional Email Delivery Integration (`done`) — depends on `6.7-01`
3. `6.7-03` Remove Raw Token Responses (reset/invite) (`done`) — depends on `6.7-02`
4. `6.7-04` Auth Endpoint Rate Limits + Abuse Controls (`done`) — depends on `6.5-03`
5. `6.7-05` Session Transport Hardening (HttpOnly cookie mode) (`done`) — depends on `6.5-03`, `6.7-04`

## Deferred Queue (LLM-Specific)

1. `8.6-06` Deterministic-First Intent Orchestrator + Optional LLM Fallback (`blocked`) — depends on `8.6-05`
2. `8.6-07` Lightweight LLM Query Normalizer Rollout (`blocked`) — depends on `8.6-06`
3. `8.6-08` NLI Evaluation Harness + Guardrails (`blocked`) — depends on `8.6-05`, `8.6-06`

---

## Phase 6 — Container Movement Optimization

## 6-01) Move Impact API
Status: `done`
- Scope:
  - Add endpoint to preview move impact before applying location move.
  - Return affected item count and sample before/after paths.
- Acceptance:
  - API returns deterministic impact summary for a valid move.
  - Existing move behavior is unchanged when preview is not requested.

## 6-02) Move Confirmation UX
Status: `done`
- Depends on: `6-01`
- Scope:
  - Add confirmation modal before location move commit.
  - Display affected counts and path change summary.
- Acceptance:
  - User can cancel safely without mutation.
  - Confirmed move reflects updated paths in UI.

## 6-03) Bulk Impact Visibility + Tests
Status: `done`
- Depends on: `6-01`, `6-02`
- Scope:
  - Add contract/UI tests for large subtree move previews and apply flow.
- Acceptance:
  - Tests cover empty, medium, and large subtree move cases.

---

## Phase 6.5 — Multi-User Accounts + Inventory Ownership

## 6.5-01) Auth + Tenant Model ADR
Status: `done`
- Scope:
  - Document auth approach (local JWT/session vs managed provider).
  - Define tenanting model (`owner_user_id` vs `tenant_id`) and migration plan.
- Acceptance:
  - ADR committed with chosen model and rollout order.

## 6.5-02) Users/Auth Schema Migration
Status: `done`
- Depends on: `6.5-01`
- Scope:
  - Add users table and auth/session persistence tables.
  - Add ownership columns to core inventory tables.
- Acceptance:
  - Migrations apply and rollback cleanly in local/staging.

## 6.5-03) Registration + Login + Logout API
Status: `done`
- Depends on: `6.5-02`
- Scope:
  - Add account creation and login endpoints.
  - Add session/token issuance and logout invalidation.
- Acceptance:
  - New user can register, login, call protected endpoint, then logout.

## 6.5-04) Password Reset Flow
Status: `done`
- Depends on: `6.5-03`
- Scope:
  - Add forgot-password and reset-password endpoints.
  - Add reset token expiration/one-time use handling.
- Acceptance:
  - Expired/reused tokens are rejected.
  - Successful reset allows login with new password.

## 6.5-05) Owner-Scoped Data Access
Status: `done`
- Depends on: `6.5-02`, `6.5-03`
- Scope:
  - Scope all inventory queries and mutations by authenticated owner.
  - Reject cross-owner object access.
- Acceptance:
  - Cross-user access attempts return forbidden/not-found consistently.

## 6.5-06) Legacy Data Migration to Initial Owner
Status: `done`
- Depends on: `6.5-05`
- Scope:
  - Create migration strategy for existing single-user inventory.
  - Assign current data to bootstrap owner account.
- Acceptance:
  - Existing records remain accessible after auth/ownership rollout.

## 6.5-07) Auth UI (Web)
Status: `done`
- Depends on: `6.5-03`
- Scope:
  - Add signup/login/logout screens and session handling in frontend.
- Acceptance:
  - Unauthenticated user is redirected to login for protected pages.

## 6.5-08) Authorization Test Matrix
Status: `done`
- Depends on: `6.5-05`
- Scope:
  - Add API contract tests for same-user access vs cross-user denial.
- Acceptance:
  - Tests prove no cross-user read/write leakage.

---

## Phase 6.6 — Shared Household Access

## 6.6-01) Household Sharing ADR + Role Matrix
Status: `done`
- Scope:
  - Define household model and permission roles (`owner`, `editor`, `viewer`).
  - Define ownership migration from `owner_user_id` to `household_id`.
- Acceptance:
  - ADR committed with role-per-endpoint matrix and migration order.

## 6.6-02) Households + Membership Schema Migration
Status: `done`
- Depends on: `6.6-01`
- Scope:
  - Add `households`, `household_members`, and invitation records.
  - Add household linkage to inventory entities.
- Acceptance:
  - Migrations apply cleanly and support at least one owner per household.

## 6.6-03) Invite + Accept API
Status: `done`
- Depends on: `6.6-02`
- Scope:
  - Add owner invite create/revoke and member accept endpoints.
  - Add invitation token expiry and single-use handling.
- Acceptance:
  - Invited user can join household membership with a one-time invite token.
  - Shared inventory data access is enabled in `6.6-04`.

## 6.6-04) Household-Scoped Access Refactor
Status: `done`
- Depends on: `6.6-02`
- Scope:
  - Refactor inventory reads/writes from user scope to household scope.
  - Enforce permissions by role.
- Acceptance:
  - Owner/editor/viewer behaviors match ADR matrix across endpoints.

## 6.6-05) Sharing Authorization Test Matrix
Status: `done`
- Depends on: `6.6-04`
- Scope:
  - Add tests for same-household collaboration and cross-household denial.
  - Add tests for viewer/edit restrictions.
- Acceptance:
  - Tests prove collaboration works without data leakage.

## 6.6-06) Sharing UI (Invite + Members + Role Management)
Status: `done`
- Depends on: `6.6-03`, `6.6-04`
- Scope:
  - Add household settings UI for invites, member list, and role edits.
- Acceptance:
  - Owner can invite/remove users and adjust roles from UI.

---

## Phase 6.7 — Auth Hardening + Verification

## 6.7-01) Email Verification Schema + Verification API
Status: `done`
- Depends on: `6.5-03`
- Scope:
  - Add verification token persistence (`email_verification_tokens`) with expiry and one-time use.
  - Add `email_verified_at` (or equivalent) to users.
  - Add endpoints for verification issue/resend/confirm flow.
- Acceptance:
  - Newly registered users can verify email through one-time token flow.
  - Expired/used tokens are rejected safely.

## 6.7-02) Transactional Email Delivery Integration
Status: `done`
- Depends on: `6.7-01`
- Scope:
  - Add provider-backed email sender abstraction for verification, password reset, and household invite delivery.
  - Add template-safe links for staging/prod domains.
- Acceptance:
  - Verification/reset/invite flows send delivery links through configured email provider.
  - Email dispatch failures are logged without exposing token secrets in API responses.

## 6.7-03) Remove Raw Token Responses (Reset + Invite)
Status: `done`
- Depends on: `6.7-02`
- Scope:
  - Remove direct `reset_token` response payload from forgot-password endpoint.
  - Remove direct `invitation_token` response payload from invitation create endpoint.
  - Update UI/tests to consume email-link flow instead of raw token display.
- Acceptance:
  - Auth/invite APIs no longer return plaintext token secrets.
  - Existing flows remain usable through email-delivered links.

## 6.7-04) Auth Endpoint Rate Limits + Abuse Controls
Status: `done`
- Depends on: `6.5-03`
- Scope:
  - Add dedicated rate limiting for register/login/forgot/reset endpoints.
  - Add abuse controls for repeated invalid login attempts and reset spam.
- Acceptance:
  - Auth endpoints return deterministic throttling responses under abuse traffic.
  - Contract coverage includes success path, throttled path, and reset abuse path.

## 6.7-05) Session Transport Hardening (HttpOnly Cookie Mode)
Status: `done`
- Depends on: `6.5-03`, `6.7-04`
- Scope:
  - Add optional HttpOnly secure cookie session transport mode (feature flag), with same-origin defaults.
  - Keep Bearer mode available for backward compatibility during rollout.
- Acceptance:
  - Web app can operate with HttpOnly cookie auth in staging.
  - Logout/reset revokes sessions correctly in both cookie and bearer modes.

---

## Phase 7 — Semantic Search

## 7-01) Embeddings Store + Provider Integration
Status: `done`
- Scope:
  - Add embeddings schema/storage.
  - Integrate embedding generation provider interface.
- Acceptance:
  - Embedding vectors persist on create/update path.

## 7-02) Backfill + Reindex Job
Status: `done`
- Depends on: `7-01`
- Scope:
  - Add batch job to generate embeddings for existing inventory.
- Acceptance:
  - Reindex job is resumable and idempotent.

## 7-03) Semantic Search API
Status: `done`
- Depends on: `7-01`, `7-02`
- Scope:
  - Add semantic retrieval endpoint and ranking strategy.
  - Blend lexical + semantic signals for MVP relevance.
- Acceptance:
  - Endpoint returns ranked results with stable pagination behavior.

## 7-04) Search UX + Relevance Checks
Status: `done`
- Depends on: `7-03`
- Scope:
  - Add UI toggle/filter for semantic search mode.
  - Add small relevance regression set.
- Acceptance:
  - Relevance checks run in CI and catch ranking regressions.

---

## Phase 8 — Natural Language Interface

## 8-01) Intent + Query Orchestrator
Status: `done`
- Scope:
  - Add intent parsing for common inventory questions and actions.
- Acceptance:
  - Parsed intents map reliably to retrieval functions for target prompts.

## 8-02) Conversational Response Composer
Status: `done`
- Depends on: `8-01`, `7-03`
- Scope:
  - Build response formatter using retrieval results and location paths.
- Acceptance:
  - Responses include item, location, and confidence/fallback messaging.

## 8-03) Chat UI Surface
Status: `done`
- Depends on: `8-02`
- Scope:
  - Add chat input/history panel in web UI.
- Acceptance:
  - User can submit follow-up queries in one session.

## 8-04) Safety + Logging Guardrails
Status: `done`
- Depends on: `8-02`
- Scope:
  - Add prompt/response logging, rate limits, and unsafe-action guardrails.
- Acceptance:
  - Sensitive actions require explicit confirmation.

---

## Phase 8.5 — Quantity Tracking + Siri Count Actions

## 8.5-01) Item Quantity Schema + API
Status: `done`
- Scope:
  - Add optional `quantity` field to items.
  - Add quantity endpoints to read/update counts with `set|add|remove`.
- Acceptance:
  - Quantity is nullable and non-negative.
  - API enforces bounds and denies negative outcomes.

## 8.5-02) Siri Quantity Intents
Status: `done`
- Depends on: `8.5-01`
- Scope:
  - Add intent parsing for `get`, `set`, `add`, `remove` quantity operations.
  - Enforce role-aware write checks for mutation intents.
- Acceptance:
  - Siri endpoint returns deterministic quantity responses for supported prompts.
  - Read-only users cannot mutate quantity via Siri actions.

## 8.5-03) Quantity UI + Contract Coverage
Status: `done`
- Depends on: `8.5-01`, `8.5-02`
- Scope:
  - Add optional quantity fields in create/edit item forms.
  - Add contract tests for quantity API and Siri quantity flows.
- Acceptance:
  - Quantity can be created/edited in UI and validated.
  - Tests cover set/add/remove/get behaviors and failure paths.

## 8.5-04) Semantic Provider Test/CI Reliability
Status: `done`
- Scope:
  - Add deterministic in-process semantic provider for local/CI (`SEARCH_PROVIDER=memory`).
  - Keep Pinecone as production provider.
- Acceptance:
  - Contract tests run without external Pinecone credentials.
  - Semantic API behavior remains deterministic across repeated runs.

## 8.5-05) Siri Quantity Confirmation + Idempotency Safety
Status: `done`
- Depends on: `8.5-02`
- Scope:
  - Require explicit confirmation for Siri quantity mutation requests.
  - Add idempotency key persistence to prevent duplicate quantity writes.
- Acceptance:
  - Mutations return confirmation-required when `confirm=true` is missing.
  - Replayed confirmed requests with the same idempotency key do not double-apply writes.

## 8.5-06) Staging Smoke Hardening for Quantity Paths
Status: `done`
- Depends on: `8.5-01`, `8.5-05`
- Scope:
  - Extend smoke script with quantity endpoint checks and Siri mutation safety checks.
  - Add bearer-auth + household header support for account-scoped staging checks.
- Acceptance:
  - Smoke script verifies quantity read/add/remove and Siri confirmation + idempotent replay flow.
  - Runbook documents auth modes and quantity smoke usage.

---

## Phase 8.6 — Lookup Normalization + Optional LLM Fallback

## 8.6-01) Deterministic Tool Route Baseline
Status: `done`
- Scope:
  - Finalize deterministic read/write route contracts as canonical execution layer.
  - Define normalized query contract for existence/count/location/related-item retrieval.
- Acceptance:
  - Tool route behavior is stable and covered by regression tests for core retrieval intents.
- Notes:
  - Completed via parser -> resolver -> handler refactor and shared read-intent contract.

## 8.6-02) Deterministic Query Normalizer + Subject Canonicalization
Status: `in_progress`
- Depends on: `8.6-01`
- Scope:
  - Add deterministic subject normalization before retrieval.
  - Support common plural/singular cleanup, filler stripping, and location hint extraction.
- Acceptance:
  - Queries like `drills`, `batteries`, and `eggs in the fridge` normalize into cleaner retrieval inputs.
  - Item resolution can use extracted location hints without changing write safety rules.

## 8.6-03) Real-Query Regression Set + Lookup Evaluation
Status: `todo`
- Depends on: `8.6-02`
- Scope:
  - Collect failed or weak real-world lookup queries from staging/product use.
  - Add deterministic regression coverage for existence/count/location/quantity prompts.
- Acceptance:
  - Regression suite catches phrase regressions before search/NLI changes ship.
  - Team can compare lookup quality changes against a stable baseline.

## 8.6-04) Pinecone Retrieval Tuning + Query/Result Cache Strategy
Status: `todo`
- Depends on: `8.6-02`
- Scope:
  - Improve Pinecone-first retrieval quality without introducing hardcoded per-item alias maps.
  - Evaluate and tighten local/server-side cache strategy for repeated semantic lookups.
- Acceptance:
  - Retrieval quality improves for paraphrased item names through vector search and deterministic normalization alone.
  - Cache strategy improves repeated lookup latency without becoming a second full vector database to maintain.

## 8.6-05) Schema-Validated Normalized Intent Contract
Status: `todo`
- Depends on: `8.6-02`
- Scope:
  - Define normalized request contract for future LLM fallback (`intent`, `subject`, `amount`, `location_hint`, `confidence`).
  - Keep deterministic handlers as the execution source of truth.
- Acceptance:
  - Contract is explicit, validated, and reusable by both deterministic and future LLM normalization paths.
  - Unsupported/unknown requests can be represented safely without mutation risk.

## 8.6-06) Deterministic-First Intent Orchestrator + Optional LLM Fallback
Status: `blocked`
- Depends on: `8.6-05`
- Scope:
  - Add orchestrator that prefers deterministic parsing and only falls back to LLM normalization on weak/ambiguous requests.
  - Keep all writes routed through existing deterministic/confirmation/idempotency controls.
- Acceptance:
  - Deterministic behavior remains the default path.
  - LLM fallback is limited to normalization and can be disabled cleanly.

## 8.6-07) Lightweight LLM Query Normalizer Rollout
Status: `blocked`
- Depends on: `8.6-06`
- Scope:
  - Add feature-flagged LLM normalization layer and rollout controls.
  - Add explicit kill switch and provider-failure fallback behavior.
- Acceptance:
  - Feature can be enabled/disabled without code changes.
  - Existing Siri/chat lookup remains functional when the LLM path is disabled.

## 8.6-08) NLI Evaluation Harness + Safety Guardrails
Status: `blocked`
- Depends on: `8.6-05`, `8.6-06`
- Scope:
  - Build benchmark prompts covering paraphrase intent mapping, false-positive suppression, and unsupported-action handling.
  - Measure deterministic-only vs optional LLM-normalized behavior.
- Acceptance:
  - Regression suite measures hit-rate, fallback-rate, and safety outcomes before and after LLM rollout.
  - Unsupported or ambiguous requests remain safely blocked.

---

## Phase 9 — Movement History

## 9-01) Movement History Schema + Write Path
Status: `done`
- Scope:
  - Add `movement_history` table and write events on move actions.
- Acceptance:
  - Every item move writes one audit event with actor and timestamps.

## 9-02) History Query API
Status: `done`
- Depends on: `9-01`
- Scope:
  - Add paginated history endpoint by item and optional date range.
- Acceptance:
  - API returns chronologically ordered movement events.

## 9-03) History Timeline UI
Status: `done`
- Depends on: `9-02`
- Scope:
  - Add item history panel showing moves and path transitions.
- Acceptance:
  - User can inspect move chain for any item from item detail screen.

---

## Phase 10 — Physical-Digital Sync

## 10-01) QR Code Generation for Locations
Status: `done`
- Scope:
  - Generate/store printable QR references for location nodes.
- Acceptance:
  - Each location has stable QR target URL/code payload.

## 10-02) Scan-to-View Endpoint + Routing
Status: `done`
- Depends on: `10-01`
- Scope:
  - Resolve scanned QR to location page with auth checks.
- Acceptance:
  - Valid QR opens the correct location context.

## 10-03) Verification Mode
Status: `done`
- Depends on: `10-02`
- Scope:
  - Add expected-vs-actual checklist mode for scanned locations.
- Acceptance:
  - User can mark found/missing items and export discrepancy list.

---

## Phase 10.5 — Frontend Experience Refresh

## 10.5-01) Web IA Split: Landing + Auth + Inventory Views
Status: `done`
- Scope:
  - Split single-page layout into dedicated landing, account access, and workspace views.
  - Keep all existing IDs/routes so no API regression is introduced.
- Acceptance:
  - Unauthenticated users land on marketing/onboarding view.
  - Authenticated users default into workspace view.

## 10.5-02) Visual Cleanup + Responsive Pass
Status: `done`
- Depends on: `10.5-01`
- Scope:
  - Refresh typography, spacing, and panel hierarchy for cleaner readability.
  - Ensure layouts remain usable on desktop and mobile breakpoints.
- Acceptance:
  - Login/account flow and inventory workspace are visually coherent and responsive.

## 10.5-03) Onboarding + Empty-State Guidance
Status: `todo`
- Depends on: `10.5-02`
- Scope:
  - Add first-use checklist for household creation/invite/search/create-item path.
  - Add actionable empty states in results/tree/history/chat areas.
- Acceptance:
  - New users can complete initial setup without external runbook guidance.

## 10.5-04) Accessibility + Keyboard Navigation
Status: `todo`
- Depends on: `10.5-02`
- Scope:
  - Add keyboard focus order, visible focus states, and modal trap/escape validation.
  - Add semantic labels/aria for critical controls and auth forms.
- Acceptance:
  - Core flows are operable without mouse and pass baseline a11y checks.

---

## Phase 11 — Mobile App + Storage Modes

## 11-01) Mobile Architecture ADR + Bootstrap
Status: `done`
- Scope:
  - Choose stack (`React Native` or `Flutter`) and create baseline app.
- Acceptance:
  - App builds on iOS/Android dev targets with shared config strategy.

## 11-02) Shared API Client + Auth Integration
Status: `todo`
- Depends on: `11-01`, `6.5-03`
- Scope:
  - Implement typed API client and authenticated request pipeline.
- Acceptance:
  - Mobile app can login and fetch user-scoped inventory.

## 11-03) Local-Only Mode Data Layer
Status: `todo`
- Depends on: `11-01`
- Scope:
  - Add on-device DB for full local-only inventory mode.
  - Add local export/import flow.
- Acceptance:
  - Inventory works offline without cloud dependency in local-only mode.

## 11-04) Cloud Sync Offline Queue + Reconciliation
Status: `todo`
- Depends on: `11-02`
- Scope:
  - Add local mutation queue and sync on connectivity restoration.
  - Implement MVP conflict strategy (last-write-wins).
- Acceptance:
  - Offline writes sync correctly after reconnect.

## 11-05) Mode Toggle + Security Baseline
Status: `todo`
- Depends on: `11-03`, `11-04`
- Scope:
  - Add user mode toggle (`Local Only` vs `Cloud Sync`) with status UI.
  - Add secure storage for tokens/keys and at-rest encryption baseline.
- Acceptance:
  - Mode switch is explicit, persisted, and safe across app restarts.

---

## Suggested Next Batch

1. `10.5-03` Frontend Onboarding + Empty States
2. `10.5-04` Frontend Accessibility + Keyboard Navigation
3. `11-02` Shared API Client + Auth Integration
4. `11-03` Local-Only Mode Data Layer
5. `11-04` Cloud Sync Offline Queue + Reconciliation
