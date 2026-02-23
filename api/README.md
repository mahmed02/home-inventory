# Home Inventory API (MVP)

## Hosting Decision (Locked for MVP)

AWS is the selected hosting target for MVP:

- API: AWS EC2 (single service) behind HTTPS
- Database: Amazon RDS for PostgreSQL
- Object Storage: Amazon S3 (images)
- TLS: AWS Certificate Manager (ACM)

No alternative hosting targets are in scope for current MVP delivery.

## Setup

1. Copy `.env.example` to `.env` inside `api/` and update `DATABASE_URL`.
2. Install dependencies:
   - `npm install`
3. Run migrations:
   - `npm run migrate`
4. Start API:
   - `npm run dev`

## Recommended Local Dev Stack (Docker)

From repo root:

0. Ensure Docker Desktop is running.
1. Start Postgres:
   - `make db-up`
2. Install API deps:
   - `make install`
3. Run migrations:
   - `make migrate`
4. Seed demo data:
   - `make seed` or use the UI `Seed Demo Data` button
5. Start server:
   - `make dev`

Default DB URL expected by `.env.example`:

- `postgres://postgres:postgres@localhost:5432/home_inventory`

## Environment Variables (Local / Staging / Production)

| Variable | Local | Staging (AWS) | Production (AWS) | Required |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | `development` | `staging` or `production` | `production` | yes |
| `PORT` | `4000` | `4000` (or platform port) | `4000` (or platform port) | yes |
| `DATABASE_URL` | local Postgres URL | RDS connection string (staging DB) | RDS connection string (prod DB) | yes |
| `ENABLE_DEV_ROUTES` | `true` | `false` | `false` | yes |
| `REQUIRE_AUTH` | `false` | `true` | `true` | yes |
| `BASIC_AUTH_USER` | optional | required when `REQUIRE_AUTH=true` | required when `REQUIRE_AUTH=true` | conditional |
| `BASIC_AUTH_PASS` | optional | required when `REQUIRE_AUTH=true` | required when `REQUIRE_AUTH=true` | conditional |
| `REQUIRE_USER_ACCOUNTS` | `false` | `false` or `true` | `true` (recommended) | optional |
| `SESSION_TTL_HOURS` | `720` | `720` | `720` | optional |
| `CORS_ALLOW_ORIGINS` | empty (same-origin only) | comma-separated allowlist | comma-separated allowlist | optional |
| `SEARCH_PROVIDER` | `postgres` | `postgres` or `pinecone` | `pinecone` (recommended) | yes |
| `APP_BASE_URL` | `http://localhost:4000` | public HTTPS staging URL | public HTTPS prod URL | yes |
| `AWS_REGION` | `us-east-1` | deployment region | deployment region | yes |
| `S3_BUCKET` | dev bucket name | staging bucket name | prod bucket name | yes |
| `AWS_ACCESS_KEY_ID` | optional | optional (prefer IAM role) | optional (prefer IAM role) | conditional |
| `AWS_SECRET_ACCESS_KEY` | optional | optional (prefer IAM role) | optional (prefer IAM role) | conditional |
| `PINECONE_API_KEY` | unset | required when `SEARCH_PROVIDER=pinecone` | required when `SEARCH_PROVIDER=pinecone` | conditional |
| `PINECONE_INDEX_NAME` | unset | required when `SEARCH_PROVIDER=pinecone` | required when `SEARCH_PROVIDER=pinecone` | conditional |
| `PINECONE_INDEX_HOST` | unset | optional (recommended for production) | optional (recommended for production) | optional |
| `PINECONE_NAMESPACE` | `home-inventory` | optional | optional | optional |
| `PINECONE_TEXT_FIELD` | `chunk_text` | optional | optional | optional |
| `PINECONE_RERANK_MODEL` | unset | optional | optional | optional |

`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are only required when you are not using IAM role credentials on compute.

`SEARCH_PROVIDER=postgres` uses in-database embeddings in `item_embeddings`.
`SEARCH_PROVIDER=pinecone` routes semantic search and Siri lookup retrieval through Pinecone integrated search.

When `REQUIRE_AUTH=true`, all endpoints except `/health` require HTTP Basic auth.
When `REQUIRE_USER_ACCOUNTS=true`, all endpoints except `/health` and `/auth/*` require a bearer session token.
Do not set both to `true` in-app at the same time (both rely on the `Authorization` header).

## AWS Deploy Checklist (MVP)

1. Provision RDS PostgreSQL and create DB/user.
2. Provision S3 bucket for images.
3. Deploy API to EC2 and set env vars from table above.
4. Run migrations on deployed API host: `npm run migrate`.
5. Attach HTTPS certificate via ACM + load balancer/reverse proxy.
6. Verify:
   - `GET /health`
   - `GET /items/search?q=...`
   - `GET /api/items/lookup?q=...`
7. Set `ENABLE_DEV_ROUTES=false` in staging/production.

For the full step-by-step runbook, use:
- `/Users/mohammedahmed/MyProjects/home_inventory/DEPLOY.md`
- CI/CD setup (GitHub Actions -> AWS SSM), use:
- `/Users/mohammedahmed/MyProjects/home_inventory/CICD.md`
- HTTPS staging and cutover rehearsal checklist:
- `/Users/mohammedahmed/MyProjects/home_inventory/STAGING_HTTPS_RUNBOOK.md`

## Endpoints (Current)

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /locations`
- `GET /locations/tree`
- `GET /locations/:id/path`
- `PATCH /locations/:id`
- `DELETE /locations/:id`
- `POST /items`
- `GET /items/:id`
- `GET /items?location_id=&limit=&offset=`
- `PATCH /items/:id`
- `DELETE /items/:id`
- `GET /items/search?q=&limit=&offset=`
- `GET /items/search/semantic?q=&mode=&limit=&offset=`
- `GET /api/items/lookup?q=`
- `GET /shortcut/find-item?q=`
- `GET /inventory/tree`
- `GET /export/inventory`
- `POST /import/inventory`
- `POST /uploads/presign`
- `POST /uploads/finalize`
- `POST /dev/seed` (dev-only; gated by `ENABLE_DEV_ROUTES`)

## MVP UI

- Open [http://localhost:4000](http://localhost:4000)
- Features:
  - Search items by keyword, hybrid mode, or semantic mode
  - Ask inventory questions in natural language with chat history (same browser session)
  - View location path
  - Move item to a new location
  - Create locations and items
  - Update/delete selected locations and items from the tree panel
  - View full inventory tree with nested locations and items (`GET /inventory/tree`)
  - Seed demo data from UI button
  - Add image URLs for locations/items and view thumbnails in search/tree

## Seed / Reset

- Reset inventory data: `npm --prefix ./api run db:reset`
- Seed demo inventory data: `npm --prefix ./api run db:seed`
- Backfill missing embeddings for existing items: `npm --prefix ./api run embeddings:reindex`
- Full embedding reindex for all items: `npm --prefix ./api run embeddings:reindex -- --mode=all`
- Chunked/resumable runs:
  - Stop after 10 batches: `npm --prefix ./api run embeddings:reindex -- --max-batches=10`
  - Resume from cursor: `npm --prefix ./api run embeddings:reindex -- --after-id=<last_item_id>`

## Backup / Restore

- Export JSON snapshot:
  - `curl http://localhost:4000/export/inventory > backup.json`
- Restore from snapshot:
  - `curl -X POST http://localhost:4000/import/inventory -H "Content-Type: application/json" --data-binary @backup.json`
- Validate snapshot without writing:
  - `curl -X POST "http://localhost:4000/import/inventory?validate_only=true" -H "Content-Type: application/json" --data-binary @backup.json`
- Merge snapshot into a non-empty inventory with ID remap:
  - `curl -X POST "http://localhost:4000/import/inventory?remap_ids=true" -H "Content-Type: application/json" --data-binary @backup.json`
- Scheduled backup with retention:
  - `BASE_URL=https://staging-inventory.your-domain.com RETAIN_DAYS=14 ./scripts/backup.sh`
- Restore drill (safe validation mode):
  - `BASE_URL=https://staging-inventory.your-domain.com ./scripts/restore-drill.sh`
- Restore drill merge mode (non-destructive to existing IDs):
  - `BASE_URL=https://staging-inventory.your-domain.com DRILL_MODE=merge ./scripts/restore-drill.sh`
- Full replace restore drill (destructive):
  - `BASE_URL=https://staging-inventory.your-domain.com DRILL_MODE=replace ALLOW_DESTRUCTIVE=true ./scripts/restore-drill.sh`

## API Response Contract

- Standard API responses now use envelopes:
  - success: `{ "ok": true, "data": ... }`
  - error: `{ "ok": false, "error": { "message": "..." } }`
- Siri endpoints remain raw for Shortcut compatibility:
  - `GET /api/items/lookup?q=`
  - `GET /shortcut/find-item?q=`
- Lookup response now includes intent metadata for conversational clients:
  - `intent`, `answer`, `confidence`, `fallback`, `requires_confirmation`

## S3 Image Uploads (Presigned URL)

1. Call `POST /uploads/presign` with:
   - `filename`
   - `content_type` (image MIME type)
   - `scope` (`item` or `location`)
2. API returns:
   - `upload_url` (presigned `PUT` URL)
   - `image_url` (public object URL to store in `image_url` field)
   - `thumbnail_url` (target thumbnail object URL)
3. Upload file bytes to `upload_url` with HTTP `PUT`.
4. Finalize thumbnail generation:
   - `POST /uploads/finalize` with `image_url`
5. Save `image_url` on item/location create or update.

Notes:
- Requires `AWS_REGION` and `S3_BUCKET`.
- Requires AWS credentials via IAM role or env keys.
- Returned `image_url` assumes objects are readable by your bucket policy or CloudFront setup.
- If SDK packages are not installed yet, run:
  - `npm --prefix ./api install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
- For server-side thumbnail generation, install `sharp`:
  - `npm --prefix ./api install sharp`

## Tests

- Setup: `cp ./api/.env.test.example ./api/.env.test`
- Create test DB: `docker exec -it home_inventory_postgres createdb -U postgres home_inventory_test`
- Run contract tests: `npm --prefix ./api test`

## Quality Checks

- Typecheck: `npm --prefix ./api run typecheck`
- Lint: `npm --prefix ./api run lint`
- Format check: `npm --prefix ./api run format:check`

## Deployment Smoke Test

- Run against staging/prod URL:
  - `BASE_URL=https://staging-inventory.your-domain.com ./scripts/smoke.sh`
- Include upload-presign check:
  - `BASE_URL=https://staging-inventory.your-domain.com CHECK_UPLOADS=true ./scripts/smoke.sh`
- With basic auth enabled:
  - `BASE_URL=https://staging-inventory.your-domain.com BASIC_AUTH_USER=<user> BASIC_AUTH_PASS=<pass> CHECK_UPLOADS=true ./scripts/smoke.sh`

## Current Migration Set

- `0001_enable_pgcrypto.sql`
- `0002_create_locations.sql`
- `0003_create_items.sql`
- `0004_add_updated_at_triggers.sql`
- `0005_drop_items_brand_low_churn.sql`
- `0006_add_user_accounts_and_ownership.sql`
- `0007_add_password_reset_tokens.sql`
- `0008_add_households_and_sharing.sql`
- `0009_add_item_embeddings.sql`

## Notes

- `locations.code` is unique per owner account; legacy unowned records keep global uniqueness.
- `keywords` is `text[]`.
- `updated_at` is automatically refreshed on updates.
- Inventory routes are owner-scoped when a valid bearer user session is present.

## Legacy Owner Bootstrap (One-Time Migration)

Use this when existing inventory rows are still unowned (`owner_user_id IS NULL`) and you want to
assign them to an initial account before enforcing user-auth-only mode.

```bash
BOOTSTRAP_OWNER_EMAIL=owner@example.com \
BOOTSTRAP_OWNER_PASSWORD='ChangeThisNow123!' \
BOOTSTRAP_OWNER_DISPLAY_NAME='Primary Owner' \
npm --prefix ./api run bootstrap:owner
```

Optional:
- `BOOTSTRAP_OWNER_UPDATE_PASSWORD=true` to rotate password if the owner account already exists.
