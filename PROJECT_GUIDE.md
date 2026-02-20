# Home Inventory Project Guide (Living Document)

This guide explains how the project works end-to-end in beginner-friendly terms.

Use this as the main onboarding doc. Keep updating it as features are added.

---

## 1) What This Project Is

This is a home inventory web app.

It helps you:
- create a tree of physical locations (House -> Garage -> Shelf)
- store items in those locations
- search items quickly
- move items/locations without losing structure
- query with Siri-friendly endpoint
- backup and restore inventory snapshots

---

## 2) Current Tech Stack

Backend/API:
- Node.js + TypeScript
- Express
- PostgreSQL

Frontend:
- Static HTML/CSS/JS served by the same Express app

Local infrastructure:
- Docker Compose (Postgres)
- Makefile for common commands

---

## 3) Project Structure

At repo root:
- `api/` -> backend + frontend static files
- `docker-compose.yml` -> local Postgres container
- `Makefile` -> helper commands
- `ROADMAP.md` -> execution plan/status
- `PROJECT_GUIDE.md` -> this document

Inside `api/`:
- `src/server.ts` -> starts server
- `src/app.ts` -> Express app + route wiring
- `src/routes/` -> API route modules
- `src/db/` -> DB pool, migrations, dev seed/reset helpers
- `src/scripts/` -> CLI scripts (`db:seed`, `db:reset`, `migrate`)
- `src/test/` -> contract/integration tests
- `public/` -> UI files (`index.html`, `app.js`, `styles.css`)
- `migrations/` -> SQL schema migrations

---

## 4) Data Model (How DB Is Organized)

### `locations` table
Represents any physical place/container:
- house, room, shelf, box, cabinet, etc.

Important columns:
- `id` (uuid)
- `name`
- `code` (human label like `G1-S2`, globally unique when non-null)
- `parent_id` (points to another location -> tree structure)
- `image_url`
- `created_at`, `updated_at`

### `items` table
Represents things you store.

Important columns:
- `id` (uuid)
- `name`
- `description`, `brand`
- `keywords` (`text[]`)
- `location_id` (which location currently contains item)
- `low_churn` (true/false)
- `image_url`
- `created_at`, `updated_at`

### Why this model works
- Tree flexibility: no fixed levels
- Easy move: moving item = update `location_id`; moving container = update `parent_id`
- Strong identity: stable UUIDs, editable names/codes

---

## 5) Request Flow (UI -> API -> DB)

Example: search for "compressor"
1. Browser sends `GET /items/search?q=compressor`
2. API runs SQL search over item fields
3. API returns matching items + location paths
4. UI renders results and move controls

Example: move item
1. UI sends `PATCH /items/:id` with new `location_id`
2. API validates UUID/payload
3. DB row is updated
4. UI refreshes tree and results

---

## 6) API Endpoints (Current)

Health:
- `GET /health`

Locations:
- `POST /locations`
- `GET /locations/tree`
- `GET /locations/:id/path`
- `PATCH /locations/:id`
- `DELETE /locations/:id`

Items:
- `POST /items`
- `GET /items/:id`
- `GET /items?location_id=&limit=&offset=`
- `PATCH /items/:id`
- `DELETE /items/:id`
- `GET /items/search?q=&limit=&offset=`

Inventory tree:
- `GET /inventory/tree`

Siri:
- `GET /api/items/lookup?q=`
- `GET /shortcut/find-item?q=` (alias)

Backup/restore:
- `GET /export/inventory`
- `POST /import/inventory`

Dev utility:
- `POST /dev/seed` (enabled by dev env flag)

---

## 7) Frontend UI (Current Features)

Main page: `http://localhost:4000`

What it can do:
- search items
- show location paths
- move items
- create location/item
- view interactive nested tree
- edit/delete selected location
- edit/delete selected item
- seed demo data from button
- show text tree representation
- display image thumbnails from `image_url`

Files:
- `api/public/index.html`
- `api/public/app.js`
- `api/public/styles.css`

---

## 8) Validations and Safety Rules

Implemented rules:
- location `code` must be globally unique (if present)
- cannot move location under itself/descendant (cycle prevention)
- cannot delete location if it still has children/items
- UUID/payload validation on key endpoints
- tests only run on test DB names containing `_test`

Backup restore safety:
- import validates structure and relationships
- import runs in a DB transaction

---

## 9) Local Setup (Beginner Steps)

From repo root:

1. Start DB:
```bash
make db-up
```

2. Install deps:
```bash
make install
```

3. Migrate schema:
```bash
make migrate
```

4. Optional seed:
```bash
make seed
```

5. Start app:
```bash
make dev
```

6. Open UI:
- `http://localhost:4000`

---

## 10) Testing and Quality

Typecheck:
```bash
npm --prefix ./api run typecheck
```

Lint:
```bash
npm --prefix ./api run lint
```

Contract tests:
```bash
npm --prefix ./api test
```

CI:
- GitHub Actions workflow at `.github/workflows/ci.yml`
- runs `typecheck` + `lint`

---

## 11) Backup and Restore

Export snapshot:
```bash
curl http://localhost:4000/export/inventory > backup.json
```

Restore snapshot:
```bash
curl -X POST http://localhost:4000/import/inventory \
  -H "Content-Type: application/json" \
  --data-binary @backup.json
```

Tip:
- take backups before risky changes

---

## 12) AWS Direction (Current Decision)

Roadmap is now aligned to AWS track.

Target stack:
- frontend/API hosting: EC2 or Amplify
- DB: RDS Postgres
- image storage: S3
- TLS: ACM

Current code is cloud-agnostic for storage (uses `image_url` now).
Direct S3 upload integration is a next step.

---

## 13) How to Extend the Project Safely

When adding a feature:
1. update `ROADMAP.md`
2. implement DB/API/UI changes
3. add/extend tests in `api/src/test/contracts.test.ts`
4. run `typecheck`, `lint`, `test`
5. update this guide (`PROJECT_GUIDE.md`)

Good rule:
- every new API behavior should be backed by at least one contract test

---

## 14) Current Gaps (Shortlist)

- hosting config finalized for AWS deployment
- direct image upload pipeline (file -> S3 -> URL)
- Siri setup walkthrough doc for non-technical household members
- breadcrumb UX in interactive explorer
- expanded edge-case tests

---

## 15) Glossary (Beginner-Friendly)

- Route/Endpoint: URL path your app exposes (example: `/items/search`)
- Migration: SQL file that changes DB schema in a controlled way
- Contract test: test that verifies API behavior from consumer perspective
- Recursive tree: nested parent/child structure with unlimited depth
- Transaction: DB operation batch that fully succeeds or fully rolls back

---

This file is intentionally a living guide. Keep it updated as architecture and behavior change.
