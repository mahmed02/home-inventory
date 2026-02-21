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
| `APP_BASE_URL` | `http://localhost:4000` | public HTTPS staging URL | public HTTPS prod URL | yes |
| `AWS_REGION` | `us-east-1` | deployment region | deployment region | yes |
| `S3_BUCKET` | dev bucket name | staging bucket name | prod bucket name | yes |
| `AWS_ACCESS_KEY_ID` | optional | optional (prefer IAM role) | optional (prefer IAM role) | conditional |
| `AWS_SECRET_ACCESS_KEY` | optional | optional (prefer IAM role) | optional (prefer IAM role) | conditional |

`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are only required when you are not using IAM role credentials on compute.

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

## Endpoints (Current)

- `GET /health`
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
- `GET /api/items/lookup?q=`
- `GET /shortcut/find-item?q=`
- `GET /inventory/tree`
- `GET /export/inventory`
- `POST /import/inventory`
- `POST /uploads/presign`
- `POST /dev/seed` (dev-only; gated by `ENABLE_DEV_ROUTES`)

## MVP UI

- Open [http://localhost:4000](http://localhost:4000)
- Features:
  - Search items by keyword
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

## Backup / Restore

- Export JSON snapshot:
  - `curl http://localhost:4000/export/inventory > backup.json`
- Restore from snapshot:
  - `curl -X POST http://localhost:4000/import/inventory -H "Content-Type: application/json" --data-binary @backup.json`
- Validate snapshot without writing:
  - `curl -X POST "http://localhost:4000/import/inventory?validate_only=true" -H "Content-Type: application/json" --data-binary @backup.json`
- Merge snapshot into a non-empty inventory with ID remap:
  - `curl -X POST "http://localhost:4000/import/inventory?remap_ids=true" -H "Content-Type: application/json" --data-binary @backup.json`

## API Response Contract

- Standard API responses now use envelopes:
  - success: `{ "ok": true, "data": ... }`
  - error: `{ "ok": false, "error": { "message": "..." } }`
- Siri endpoints remain raw for Shortcut compatibility:
  - `GET /api/items/lookup?q=`
  - `GET /shortcut/find-item?q=`

## S3 Image Uploads (Presigned URL)

1. Call `POST /uploads/presign` with:
   - `filename`
   - `content_type` (image MIME type)
   - `scope` (`item` or `location`)
2. API returns:
   - `upload_url` (presigned `PUT` URL)
   - `image_url` (public object URL to store in `image_url` field)
3. Upload file bytes to `upload_url` with HTTP `PUT`.
4. Save `image_url` on item/location create or update.

Notes:
- Requires `AWS_REGION` and `S3_BUCKET`.
- Requires AWS credentials via IAM role or env keys.
- Returned `image_url` assumes objects are readable by your bucket policy or CloudFront setup.
- If SDK packages are not installed yet, run:
  - `npm --prefix ./api install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`

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

## Current Migration Set (Tickets 1-4)

- `0001_enable_pgcrypto.sql`
- `0002_create_locations.sql`
- `0003_create_items.sql`
- `0004_add_updated_at_triggers.sql`

## Notes

- `locations.code` is globally unique when non-null.
- `keywords` is `text[]`.
- `updated_at` is automatically refreshed on updates.
