# Home Inventory Project Audit Report

Date: 2026-02-22
Auditor: Codex (GPT-5)
Repository: `/Users/mohammedahmed/MyProjects/home_inventory`

## 1) Executive Summary

This project is in strong MVP shape functionally, but has significant security exposure if reachable on a public network.

- Roadmap completion: **68/96 tasks (70.8%)** overall.
- Remaining MVP gap completion: **16/19 tasks (84.2%)**.
- Remaining MVP gap items still open:
  - Public staging domain + HTTPS
  - HTTPS smoke checks (`CHECK_UPLOADS=true`)
  - One restore drill run in staging
- Quality gates now:
  - `typecheck`: pass
  - `lint`: pass
  - `format:check`: fail (10 files)
  - `test`: fail in this environment (Postgres unavailable at `localhost:5432`)

Top risk theme: **no authentication/authorization on destructive endpoints + stored XSS in the UI + unbounded image processing path**.

## 2) Scope and Method

This audit covered:

- Static review of API, UI, DB migrations, scripts, and CI/CD workflows.
- Current roadmap/progress verification.
- Security-focused review of attack surface, data exposure, and operational controls.
- Local quality checks:
  - `npm --prefix ./api run typecheck`
  - `npm --prefix ./api run lint`
  - `npm --prefix ./api run format:check`
  - `npm --prefix ./api test`
  - `npm --prefix ./api audit --omit=dev --audit-level=high` (network-blocked)

## 3) Current Progress Snapshot

### 3.1 Roadmap status

From `ROADMAP.md`:

- Completed tasks: 68
- Open tasks: 28
- Overall completion: 70.8%

Remaining MVP gap specifically:

- Completed: 16
- Open: 3
- MVP gap completion: 84.2%

### 3.2 Current worktree state

Worktree is dirty with uncommitted changes (new upload/thumbnail and backup/restore tooling present). This is not inherently bad, but release discipline should include commit grouping and tagged release points.

## 4) Security Findings (Prioritized)

## [CRITICAL] API has no authN/authZ, including destructive routes

Evidence:

- No auth middleware in route stack: `/Users/mohammedahmed/MyProjects/home_inventory/api/src/app.ts:16-25`
- Full export endpoint (data exfiltration): `/Users/mohammedahmed/MyProjects/home_inventory/api/src/routes/export.ts:245`
- Full import replace endpoint (destructive mutation): `/Users/mohammedahmed/MyProjects/home_inventory/api/src/routes/export.ts:267`
- Delete item/location endpoints are public: `/Users/mohammedahmed/MyProjects/home_inventory/api/src/routes/items.ts:191`, `/Users/mohammedahmed/MyProjects/home_inventory/api/src/routes/locations.ts:299`

Impact:

- Any caller with network access can read full inventory and mutate/delete/replace data.
- If public HTTPS is enabled before auth, this becomes internet-exposed.

Recommendation:

1. Add authentication (minimum: API key or signed token for MVP; stronger: OIDC/JWT).
2. Add authorization policy by endpoint class (read vs write vs admin).
3. Require auth for export/import/dev/upload endpoints immediately.

## [HIGH] Stored XSS in UI render path via unsanitized `innerHTML`

Evidence:

- Unsafe HTML interpolation into select options and result/tree markup:
  - `/Users/mohammedahmed/MyProjects/home_inventory/api/public/app.js:263-270`
  - `/Users/mohammedahmed/MyProjects/home_inventory/api/public/app.js:358-407`
  - `/Users/mohammedahmed/MyProjects/home_inventory/api/public/app.js:558-583`
- User-controlled values (`item.name`, `location.name`, `location_path`) are inserted directly into HTML strings.

Impact:

- A malicious item/location name can execute script in any viewer’s browser.
- Can lead to token/session theft (if auth later added), data tampering, or lateral movement.

Recommendation:

1. Replace string-based HTML building with safe DOM APIs (`textContent`, `createElement`).
2. If templating remains, apply strict HTML escaping for all dynamic text.
3. Add regression tests for payloads like `<img onerror=...>` and `<script>`.

## [HIGH] Thumbnail finalize endpoint is vulnerable to resource exhaustion

Evidence:

- Public finalize route: `/Users/mohammedahmed/MyProjects/home_inventory/api/src/routes/uploads.ts:186`
- Entire S3 object read into memory: `/Users/mohammedahmed/MyProjects/home_inventory/api/src/routes/uploads.ts:76-117`, `234`
- Sharp processing runs synchronously in request path: `/Users/mohammedahmed/MyProjects/home_inventory/api/src/routes/uploads.ts:235-243`
- No server-side object size guard before processing.

Impact:

- Large image objects can spike memory/CPU and degrade or crash API.
- Easy abuse if endpoint is exposed and unauthenticated.

Recommendation:

1. Require auth for `/uploads/finalize`.
2. Enforce max object size before download/process (e.g., via S3 `HeadObject`).
3. Move thumbnail generation off request path (queue/worker).
4. Add per-IP/user rate limiting.

## [MEDIUM] Presign flow advertises size limit but does not enforce it server-side

Evidence:

- Response returns `max_size_mb: 10`: `/Users/mohammedahmed/MyProjects/home_inventory/api/src/routes/uploads.ts:179`
- Client-side-only check: `/Users/mohammedahmed/MyProjects/home_inventory/api/public/app.js:188-190`
- Presigned PUT command does not enforce content-length constraints: `/Users/mohammedahmed/MyProjects/home_inventory/api/src/routes/uploads.ts:162-167`

Impact:

- Large uploads may be accepted if client bypasses UI checks.
- Increases storage and processing cost risk.

Recommendation:

- Enforce upload size with signed POST policy conditions or verify object size before finalize and reject over-limit assets.

## [MEDIUM] Dev seed route can be enabled by default outside production

Evidence:

- Default behavior enables dev routes when `NODE_ENV !== "production"`: `/Users/mohammedahmed/MyProjects/home_inventory/api/src/config/env.ts:20-27`
- Route exists at `/dev/seed`: `/Users/mohammedahmed/MyProjects/home_inventory/api/src/routes/dev.ts:15`

Impact:

- Misconfigured staging can expose seed mutation endpoint.

Recommendation:

- Invert default: dev routes disabled unless explicitly `ENABLE_DEV_ROUTES=true`.

## [MEDIUM] Workflow-dispatch `ref` is interpolated into shell command without escaping

Evidence:

- Dynamic command interpolation from input `ref`:
  - `/Users/mohammedahmed/MyProjects/home_inventory/.github/workflows/deploy.yml:75`
  - `/Users/mohammedahmed/MyProjects/home_inventory/.github/workflows/deploy.yml:78`

Impact:

- A maliciously crafted `ref` can inject shell commands on EC2 via SSM (insider/account-compromise scenario).

Recommendation:

1. Validate `ref` against strict regex (SHA/branch/tag safe chars).
2. Pass values as positional args to script rather than shell-concatenated command strings.

## [MEDIUM] Deploy script installs runtime packages outside lockfile

Evidence:

- `npm install --no-save --no-package-lock ... sharp` on every deploy: `/Users/mohammedahmed/MyProjects/home_inventory/scripts/deploy.sh:32`
- `sharp` absent from committed `dependencies`: `/Users/mohammedahmed/MyProjects/home_inventory/api/package.json:21-27`

Impact:

- Non-deterministic builds and supply-chain drift between deploys.

Recommendation:

- Add `sharp` to `api/package.json` dependencies and remove no-save install from deploy script.

## [MEDIUM] Missing HTTP hardening middleware

Evidence:

- No `helmet`, CORS policy, or rate-limit middleware in app setup: `/Users/mohammedahmed/MyProjects/home_inventory/api/src/app.ts:16-25`

Impact:

- Weaker browser and abuse protections at the edge/API layer.

Recommendation:

- Add `helmet`, explicit CORS policy, and route-specific rate limits (especially search/upload/import/export).

## 5) Quality and Delivery Findings

## [MEDIUM] CI does not run tests or formatting checks

Evidence:

- CI workflow only runs typecheck and lint: `/Users/mohammedahmed/MyProjects/home_inventory/.github/workflows/ci.yml:28-32`

Impact:

- Regressions in behavior and formatting can merge undetected.

Recommendation:

- Add `format:check` and `test` (with service Postgres) to CI pipeline.

## [LOW] Formatting drift currently present

Evidence:

- `npm --prefix ./api run format:check` reports 10 files out of format.

Impact:

- Inconsistent diffs/readability and potential review friction.

Recommendation:

- Run `npm --prefix ./api run format` and enforce format check in CI.

## [LOW] Documentation drift exists

Examples:

- `PROJECT_GUIDE.md` “Current Gaps” still lists already-completed items (direct upload, breadcrumbs, expanded tests): `/Users/mohammedahmed/MyProjects/home_inventory/PROJECT_GUIDE.md:288-295`
- `api/README.md` “Current Migration Set (Tickets 1-4)” omits `0005` even though migration exists.

Recommendation:

- Align guide/README with current implementation before next release cut.

## 6) Validation Results (Commands)

- `npm --prefix ./api run typecheck` -> pass
- `npm --prefix ./api run lint` -> pass
- `npm --prefix ./api run format:check` -> fail (10 files)
- `npm --prefix ./api test` -> fail in this environment due DB unavailable (`ECONNREFUSED localhost:5432`)
- `npm --prefix ./api audit --omit=dev --audit-level=high` -> could not run (network/DNS blocked to npm registry)

## 7) Positive Findings

- Core data integrity rules are in place:
  - Unique non-null location code index
  - Location cycle prevention
  - Delete guards for non-empty locations
- Import pipeline has strong structural validation and transaction semantics:
  - cycle checks, foreign-key consistency, duplicate checks
  - rollback on failure
- Environment docs and runbooks are substantial and practical.

## 8) Recommended Remediation Plan

### Immediate (next 24-72 hours)

1. Add auth guard for all mutation/export/import/upload/dev routes.
2. Fix stored XSS by removing unsafe `innerHTML` rendering patterns.
3. Add server-side upload/object size limits and protect `/uploads/finalize`.
4. Disable dev routes by default unless explicitly enabled.

### Short term (this week)

1. Harden deploy workflow ref handling and avoid shell interpolation.
2. Make deploy deterministic by locking `sharp` in `package.json`.
3. Add `format:check` + integration tests in CI with Postgres service.
4. Add rate limiting + security headers.

### Before public HTTPS exposure

1. Complete remaining MVP gap items in `ROADMAP.md`.
2. Run staging restore drill and document evidence.
3. Re-run full audit after auth and XSS remediations.

## 9) Overall Risk Rating

Current state risk for private/trusted LAN: **Moderate**.

Current state risk for public internet exposure: **High/Critical** until auth and XSS issues are fixed.
