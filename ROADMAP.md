# Home Inventory System — Execution Roadmap

This version tracks implementation in three views:

1. Completed (current state)
2. Remaining MVP gap
3. Post-MVP backlog

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

### Phase 5 — Photo Support (partial)
- [x] `image_url` persisted/updated for locations and items
- [x] Image URL fields in create/edit forms
- [x] Thumbnail rendering in search results and tree items
- [x] Presigned S3 upload endpoint (`POST /uploads/presign`)
- [x] UI upload buttons wired for create/edit item/location
- [x] End-to-end upload validated in AWS (presign + PUT + render)

### Phase 5.5 — First Deployment Validation (private)
- [x] AWS EC2 + RDS + S3 environment created
- [x] Migrations executed on EC2 against RDS
- [x] API process managed with PM2
- [x] Private network validation over Tailscale
- [x] Smoke checks passed (`/health`, search, Siri)

---

## 2) Remaining MVP Gap

These are the remaining tasks to consider MVP fully hardened for solo/household use.

### Platform / Ops
- [x] Decide hosting target (AWS stack vs Vercel/Supabase)
- [x] Add baseline lint/format config and CI checks
- [x] Add deployment checklist (env vars, DB migration runbook, backup schedule)
- [ ] Add public staging domain + HTTPS (ACM + ALB/Nginx + DNS)
- [ ] Run smoke checks on HTTPS staging URL (including `CHECK_UPLOADS=true`)
- [x] Add production cutover + rollback rehearsal notes after first HTTPS deploy

### Data / Quality
- [x] Add migration test for unique `locations.code`
- [x] Expand API tests to include location path endpoint and delete edge cases
- [x] Add test for `/dev/seed` gating behavior (`ENABLE_DEV_ROUTES`)

### API / UX
- [x] Document Siri Shortcut setup flow clearly (step-by-step)
- [x] Add breadcrumb display in the interactive explorer (UI-level)
- [x] Standardize response envelopes if desired (currently mixed direct object/list responses)

### Backup / Safety
- [x] Add import dry-run mode (`validate_only=true`)
- [x] Add optional id remap mode for merging into non-empty inventories (future-safe)
- [x] Automate scheduled backup export and retention policy
- [ ] Run one restore drill from backup JSON in staging

### Photo Support (to complete Phase 5)
- [x] Add direct file upload for item/location images
- [x] Add storage integration (S3/Supabase/Cloudinary)
- [x] Add server-side thumbnail generation pipeline

---

## 3) Post-MVP Backlog

### Phase 6 — Container Movement Optimization
- [ ] Location move confirmation UX and bulk impact visibility
- [ ] Optional move preview (before/after path for affected items)

### Phase 7 — Semantic Search
- [ ] Add embeddings column/store
- [ ] Generate embeddings on create/update
- [ ] Similarity query + ranking

### Phase 8 — Natural Language Interface
- [ ] Chat-style query input
- [ ] Retrieval + response formatting for conversational lookup

### Phase 9 — Movement History
- [ ] `movement_history` table
- [ ] Item move event logging
- [ ] History view in UI

### Phase 10 — Physical-Digital Sync
- [ ] QR generation for locations
- [ ] Scan-to-view experience
- [ ] Verification mode for expected vs actual inventory

### Phase 11 — Mobile App + Storage Modes
- [ ] Define mobile stack (`React Native` or `Flutter`) and baseline app architecture
- [ ] Local-only mode (single-user):
- [ ] Store full inventory in on-device DB (SQLite/Realm)
- [ ] Disable multi-user sync features in local-only mode
- [ ] Provide local export/import backup flow for device migration
- [ ] Cloud mode with offline support:
- [ ] Use cloud API as source of truth when online
- [ ] Keep local on-device cache for offline read/write
- [ ] Queue offline mutations and sync/reconcile when internet returns
- [ ] Conflict strategy for cloud mode (last-write-wins for MVP, upgrade later if needed)
- [ ] User-facing mode toggle and clear mode status indicator (`Local Only` vs `Cloud Sync`)
- [ ] Security baseline for mobile storage (at-rest encryption + secure token/key handling)

---

## Milestones

- Milestone A: Backend MVP Complete (Phases 1–3)
- Milestone B: Product MVP Usable (Phase 4)
- Milestone C: Photo Workflow Complete (Phase 5)
- Milestone D: Intelligent Search (Phases 7–8)
- Milestone E: Advanced Control System (Phases 9–10)

---

End of Roadmap
