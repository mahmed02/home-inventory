# HTTPS Staging + Cutover Runbook

This runbook closes the operational MVP gap for HTTPS staging, smoke checks, and first production cutover rehearsal.

## 1) Public staging domain + HTTPS

1. Create DNS record:
- `staging.myhomeinventory.net` -> ALB DNS name (or EC2 public IP if using Nginx only).

2. Provision TLS certificate in ACM:
- Request cert for `staging.myhomeinventory.net`.
- Complete DNS validation.

3. Attach certificate:
- ALB listener 443 with ACM cert (recommended), or
- Nginx terminating TLS on EC2.

4. Update app env on staging host:
- `APP_BASE_URL=https://staging.myhomeinventory.net`
- `ENABLE_DEV_ROUTES=false`
- `REQUIRE_AUTH=true`
- `BASIC_AUTH_USER=john`
- `BASIC_AUTH_PASS=smith`

5. Restart API process and verify:
- `curl https://staging.myhomeinventory.net/health`

## 2) HTTPS smoke checks

Run after deploy:

```bash
BASE_URL=https://staging.myhomeinventory.net CHECK_UPLOADS=true ./scripts/smoke.sh

# With auth enabled:
BASE_URL=https://staging.myhomeinventory.net BASIC_AUTH_USER=john BASIC_AUTH_PASS=smith CHECK_UPLOADS=true ./scripts/smoke.sh
```

Expected:
- Health, search, Siri lookup pass
- Upload presign check passes

## 3) Restore drill checklist (staging)

Run validation-only drill first:

```bash
BASE_URL=https://staging.myhomeinventory.net ./scripts/restore-drill.sh

# With auth enabled:
BASE_URL=https://staging.myhomeinventory.net BASIC_AUTH_USER=john BASIC_AUTH_PASS=smith ./scripts/restore-drill.sh
```

Optional merge drill:

```bash
BASE_URL=https://staging.myhomeinventory.net DRILL_MODE=merge ./scripts/restore-drill.sh
```

Only run full replace when approved:

```bash
BASE_URL=https://staging.myhomeinventory.net DRILL_MODE=replace ALLOW_DESTRUCTIVE=true ./scripts/restore-drill.sh
```

## 4) First production cutover rehearsal notes

Capture this immediately after first HTTPS staging deploy.

- Rehearsal date (UTC): ____________________
- Build/commit: ____________________
- Staging URL tested: ____________________
- Smoke checks (`CHECK_UPLOADS=true`): pass / fail
- Backup script run: pass / fail
- Restore drill mode run: validate / merge / replace
- Restore drill result: pass / fail

Rollback steps rehearsed:
1. Repoint traffic to previous target (ALB target group / Nginx upstream).
2. Revert app env to previous release values.
3. Redeploy previous build.
4. Run smoke checks on rollback target.

Rollback evidence:
- Previous release id: ____________________
- Time to rollback: ____________________
- Post-rollback smoke status: pass / fail

## 5) Production cutover procedure

1. Confirm staging smoke checks pass on HTTPS.
2. Confirm fresh backup exists (`./scripts/backup.sh`).
3. Deploy production build.
4. Run production smoke checks:

```bash
BASE_URL=https://inventory.myhomeinventory.net CHECK_UPLOADS=true ./scripts/smoke.sh
```

5. Monitor logs and DB health for 30 minutes.
6. If regressions appear, execute rollback steps above.
