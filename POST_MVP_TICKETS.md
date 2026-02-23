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

## Active Queue (Current)

1. `10-01` QR Code Generation for Locations (`todo`) — next up
2. `10-02` Scan-to-View Endpoint + Routing (`todo`) — depends on `10-01`
3. `10-03` Verification Mode (`todo`) — depends on `10-02`

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
Status: `todo`
- Scope:
  - Generate/store printable QR references for location nodes.
- Acceptance:
  - Each location has stable QR target URL/code payload.

## 10-02) Scan-to-View Endpoint + Routing
Status: `todo`
- Depends on: `10-01`
- Scope:
  - Resolve scanned QR to location page with auth checks.
- Acceptance:
  - Valid QR opens the correct location context.

## 10-03) Verification Mode
Status: `todo`
- Depends on: `10-02`
- Scope:
  - Add expected-vs-actual checklist mode for scanned locations.
- Acceptance:
  - User can mark found/missing items and export discrepancy list.

---

## Phase 11 — Mobile App + Storage Modes

## 11-01) Mobile Architecture ADR + Bootstrap
Status: `todo`
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

1. `10-01` QR Code Generation for Locations
2. `10-02` Scan-to-View Endpoint + Routing
3. `10-03` Verification Mode
4. `11-01` Mobile Architecture ADR + Bootstrap
5. `11-02` Shared API Client + Auth Integration
