# Home Inventory System — Execution Roadmap

Last updated: **2026-02-23**

This roadmap tracks:
1. Completed capabilities
2. MVP gap status
3. Post-MVP backlog
4. Recommended next task sequence

---

## 1) Completed (Current State)

### Phase 0 — Foundation Setup
- [x] Repository initialized
- [x] Backend project structure created (`api/`)
- [x] Environment config wired (`.env`, `.env.example`)
- [x] Migration runner implemented
- [x] Local Docker Postgres setup added (`docker-compose.yml`)
- [x] Makefile workflow added (`db-up`, `migrate`, `seed`, `dev`, `test`)

### Phase 1 — Core Data Model
- [x] `locations` table created
- [x] `items` table created
- [x] `locations.parent_id` index added
- [x] `locations.code` unique non-null index added (global uniqueness)
- [x] `items.location_id` index added
- [x] `items.keywords` GIN index added
- [x] `updated_at` triggers added

### Phase 2 — Core API Layer
- [x] `POST /locations`
- [x] `GET /locations/tree`
- [x] `GET /locations/:id/path`
- [x] `PATCH /locations/:id`
- [x] `DELETE /locations/:id`
- [x] Cycle prevention on location move
- [x] Delete guard (no child/item)
- [x] `POST /items`
- [x] `GET /items/:id`
- [x] `GET /items?location_id=&limit=&offset=`
- [x] `PATCH /items/:id`
- [x] `DELETE /items/:id`
- [x] Shared validation/error helper modules

### Phase 3 — Search + Siri + Backup
- [x] `GET /items/search?q=&limit=&offset=` (ILIKE over name/description/keywords)
- [x] Location path returned in search results
- [x] Siri endpoint: `GET /api/items/lookup?q=`
- [x] Siri alias endpoint: `GET /shortcut/find-item?q=`
- [x] Export endpoint: `GET /export/inventory`
- [x] Import endpoint: `POST /import/inventory`
- [x] Contract tests for search, Siri, update/delete, export/import

### Phase 4 — Product MVP UI
- [x] Global search UI
- [x] Quick create location/item forms
- [x] Move item UI from search results
- [x] Recursive interactive tree + text tree view
- [x] Location editor (update/delete)
- [x] Item editor (update/delete)
- [x] Modal action launcher (`+`) for create/edit flows
- [x] Dev seed button wired to backend (`POST /dev/seed`)

### Phase 5 — Photo Support
- [x] `image_url` persisted/updated for locations and items
- [x] Image URL fields in create/edit forms
- [x] Thumbnail rendering in search results and tree items
- [x] Presigned S3 upload endpoint (`POST /uploads/presign`)
- [x] UI upload buttons wired for create/edit item/location
- [x] Server-side thumbnail generation
- [x] End-to-end upload validated in AWS (presign + PUT + render)

### Phase 5.5 — Staging + HTTPS Validation
- [x] AWS EC2 + RDS + S3 environment created
- [x] API process managed with PM2
- [x] Private validation over Tailscale (`http://100.84.48.109:4000`)
- [x] Public staging domain + HTTPS configured (`https://staging.myhomeinventory.net`)
- [x] Cloudflare DNS hooked to AWS target
- [x] Smoke checks passed on staging (`/health`, search, Siri, semantic)

### Phase 5.6 — Deploy Pipeline Hardening
- [x] GitHub Actions deploy workflow integrated with AWS SSM + OIDC
- [x] Workflow updated to run remote deploy as app user (not root deploy flow)
- [x] Deploy script hardened with startup health retry/backoff
- [x] Deploy script uses unique temp files + cleanup trap
- [x] Deploy script normalizes API dir ownership and clears stale `node_modules` before `npm ci`

### Phase 6 — Container Movement Optimization
- [x] Location move confirmation UX and bulk impact visibility
- [x] Optional move preview (before/after path for affected items)

### Phase 6.5 — Multi-User Accounts + Inventory Ownership
- [x] Users table + account registration/login flow
- [x] Session auth + password reset flow
- [x] Ownership field added to inventory entities
- [x] Owner-scoped authorization enforced
- [x] Authorization test matrix added (cross-user denial)
- [x] Legacy single-inventory data migrated to initial owner

### Phase 6.6 — Shared Household Access
- [x] `households` + `household_members` roles (`owner`, `editor`, `viewer`)
- [x] Invite + accept membership flow
- [x] Household-scoped authorization model
- [x] Role-based permissions on create/update/delete
- [x] Cross-household auth tests
- [x] Sharing UX (invite/member/role management)

### Phase 7 — Semantic Search (Major Advancement)
- [x] Search provider abstraction introduced
- [x] Pinecone integrated semantic backend wired
- [x] Household-aware semantic retrieval with lexical/semantic/hybrid modes
- [x] Resumable reindex/backfill job for item indexing
- [x] Search UI toggle for lexical/hybrid/semantic
- [x] Relevance regression checks in CI
- [x] Legacy in-app Postgres semantic runtime path removed (Pinecone-first runtime)

### Phase 8 — Natural Language Interface (Major Advancement)
- [x] Conversational intent/query orchestrator for inventory questions
- [x] Chat-style UI experience
- [x] Siri lookup aligned to conversational answer path
- [x] Safer fallback behavior and unsupported-action guardrails

### Phase 8.5 — Inventory Quantity Tracking + Siri Actions
- [x] Optional quantity field on items with non-negative validation
- [x] Quantity API operations (`get`, `set`, `add`, `remove`)
- [x] Siri quantity intents and role-aware mutation guardrails
- [x] UI quantity inputs for create/edit item flow

---

## 2) MVP Gap Status

### MVP hardening status: **closed**
- Core MVP + staging HTTPS + backups + photo uploads + multi-user household sharing are complete.
- Current effort focus is now **Post-MVP Phases 9+**.

---

## 3) Post-MVP Backlog

Execution tickets: `/Users/mohammedahmed/MyProjects/home_inventory/POST_MVP_TICKETS.md`

### Phase 8.5 — Inventory Quantity Tracking + Siri Actions
- [x] Quantity schema migration + API endpoints
- [x] Siri get/set/add/remove quantity support
- [x] Contract tests + UI support for quantity fields

### Phase 9 — Movement History
- [x] `movement_history` table
- [x] Item move event logging
- [x] History query API (paginated + optional date range)
- [x] History view in UI

### Phase 10 — Physical-Digital Sync
- [x] QR generation for locations
- [x] Scan-to-view experience
- [x] Verification mode for expected vs actual inventory

### Phase 11 — Mobile App + Storage Modes
- [ ] Define mobile stack (`React Native` or `Flutter`) and baseline app architecture
- [ ] Local-only mode (single-user): on-device DB + export/import
- [ ] Cloud mode with offline support: cached reads/writes + mutation queue + reconciliation
- [ ] Conflict strategy for cloud mode (MVP: last-write-wins)
- [ ] Mode toggle UI (`Local Only` vs `Cloud Sync`)
- [ ] Mobile security baseline (at-rest encryption + secure token/key handling)

---

## 4) Next Tasks (Recommended Order)

### Queued Now
1. `11-01` Mobile architecture ADR + bootstrap
2. `11-02` Shared API client + mobile auth integration
3. `11-03` Local-only mode data layer

### Next Batch (immediately actionable)
1. `11-01` Mobile architecture ADR + bootstrap
2. `11-02` Shared API client + mobile auth integration
3. `11-03` Local-only mode data layer
4. `11-04` Cloud sync offline queue + reconciliation
5. `11-05` Mode toggle + security baseline

### Follow-up Batch
1. `11-01` Mobile architecture ADR + bootstrap
2. `11-02` Shared API client + mobile auth integration
3. `11-03` Local-only mode data layer

---

## Milestones

- Milestone A: Backend MVP Complete (Phases 1–3)
- Milestone B: Product MVP Usable (Phase 4)
- Milestone C: Photo Workflow Complete (Phase 5)
- Milestone D: Intelligent Search + NLI Complete (Phases 7–8)
- Milestone E: Advanced Control System (Phases 9–10)

---

End of Roadmap
