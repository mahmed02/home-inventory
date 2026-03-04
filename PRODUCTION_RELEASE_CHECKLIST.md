# Production Release Checklist

Last updated: 2026-02-28
Owner: `@mohammed`
Repo: `/Users/mohammedahmed/MyProjects/home_inventory`

This checklist is strict by design. Public launch should happen only when all **P0** items are complete.

---

## Launch Decision

- Launch target date: `__________________`
- Release commit/tag: `__________________`
- Production base URL: `https://__________________`
- Go/No-Go owner: `__________________`

Go/No-Go rule:
- **GO** only if all P0 items are checked and evidence is recorded.
- **NO-GO** if any P0 item is open or unverified.

---

## P0 (Must Have Before Public Launch)

### P0-01) Transactional email is working (reset/verify/invite)
- [x] `EMAIL_PROVIDER=resend` configured in production env
- [x] `EMAIL_FROM` uses verified sender domain
- [x] `EMAIL_RESEND_API_KEY` valid in runtime process
- [x] Forgot-password sends to real inbox
- [x] Verify-email sends to real inbox
- [x] Household invite sends to real inbox
- [x] No `delivery":"failed"` in API responses during smoke

Evidence:
- `pm2 logs home-inventory-api --lines 200`
- Curl/API response samples: `________________________________________`

### P0-02) Auth posture for public users is correct
- [x] `REQUIRE_AUTH=false` (no basic-auth wall for customers)
- [x] `REQUIRE_USER_ACCOUNTS=true`
- [x] `SESSION_TRANSPORT=hybrid` (or `cookie`, if chosen)
- [x] `SESSION_COOKIE_SECURE=true`
- [x] `SESSION_COOKIE_SAME_SITE=lax` (or stricter if intended)
- [x] Register/login/logout works from browser
- [x] Password reset flow end-to-end works

Evidence:
- Env snapshot (`pm2 env 0` selected vars): `_______________________`
- Browser + curl validation notes: `________________________________`

### P0-03) Secrets are rotated after prior exposure risk
- [x] DB credential rotated
- [x] AWS credentials/role keys rotated (if any static keys used)
- [x] Resend API key rotated
- [x] Any leaked tokens/passwords invalidated
- [x] Local secret files confirmed not tracked by git

Evidence:
- Rotation date/time (UTC): `__________________`
- Rotation runbook/notes: `________________________________________`

### P0-04) Backup and restore are proven
- [x] Scheduled backup job enabled (daily minimum)
- [x] Retention policy set (recommended 14+ days)
- [x] Latest backup artifact verified
- [x] Restore drill executed successfully (validate or merge mode minimum)
- [x] Recovery steps documented with real timings

Commands:
- `BASE_URL=https://<prod-domain> ./scripts/backup.sh`
- `BASE_URL=https://<prod-domain> ./scripts/restore-drill.sh`
- `BASE_URL=https://<prod-domain> AUTH_EMAIL=<account_email> AUTH_PASSWORD=<account_password> HOUSEHOLD_ID=<household_id> ./scripts/backup.sh`
- `BASE_URL=https://<prod-domain> AUTH_EMAIL=<account_email> AUTH_PASSWORD=<account_password> HOUSEHOLD_ID=<household_id> ./scripts/restore-drill.sh`

Evidence:
- Last backup file: `/srv/home_inventory/backups/inventory-20260302T063436Z.json`
- Restore drill result/time: `Succeeded; Backup time UTC: 2026-03-02T06:34:36Z`

### P0-05) Monitoring and alerting are in place
- [x] External uptime check for `/health`
- [x] Alerting for process down / 5xx / high error rate
- [x] Access to Nginx + API logs
- [x] On-call contact for launch window

Evidence:
- Monitoring tool(s): `ntfy`
- Alert channel: `home_inventory_alerts_9094184710383748`

### P0-06) Release + rollback path is proven
- [x] GitHub Actions deploy to production path confirmed
- [x] Production environment approval gate enabled
- [x] Known-good rollback commit identified
- [x] Rollback command/procedure tested in staging with smoke pass

Evidence:
- Rollback ref: `f56e70d`
- Last rollback rehearsal: `3/3/2026`

### P0-07) Production DNS/TLS/cutover is complete
- [x] Production DNS record points to correct target
- [x] TLS cert valid and auto-renewing
- [x] `APP_BASE_URL` set to production HTTPS URL
- [x] CORS allowlist is production-safe
- [x] `/health` returns 200 over HTTPS

Evidence:
- `curl -sv https://<prod-domain>/health`
- Cert validity dates: `May 23 21:17:54 2026 GMT`

---

## P1 (Recommended, Not Blocking Launch)

### P1-01) Search quality improvements
- [ ] Improve relevance tuning for semantic/hybrid
- [ ] Add production query analytics for low-confidence/empty results

### P1-02) UX polish
- [ ] `10.5-03` onboarding + empty states
- [ ] `10.5-04` keyboard navigation + accessibility pass

### P1-03) Product analytics
- [ ] Signup funnel instrumentation
- [ ] Core action success/failure tracking

---

## Production Smoke Test (Run Immediately After Deploy)

Set env:

```bash
export BASE_URL="https://<prod-domain>"
```

Core smoke:

```bash
./scripts/smoke.sh
```

Account/household/quantity smoke:

```bash
BASE_URL="$BASE_URL" \
AUTH_EMAIL="<account_email>" \
AUTH_PASSWORD="<account_password>" \
HOUSEHOLD_ID="<household_id>" \
CHECK_QUANTITY=true \
QUANTITY_QUERY=tool \
./scripts/smoke.sh
```

Alternate (if bearer token available):

```bash
BASE_URL="$BASE_URL" \
AUTH_BEARER_TOKEN="<session_token>" \
HOUSEHOLD_ID="<household_id>" \
CHECK_QUANTITY=true \
QUANTITY_QUERY=tool \
./scripts/smoke.sh
```

Email smoke (manual):
- Trigger forgot-password for real test account.
- Create test household invite to real inbox.
- Verify email flow from received link.

---

## Launch Sign-off

- [x] Engineering sign-off
- [x] Operations sign-off
- [x] Product sign-off
- [x] Go/No-Go recorded

Decision:
- `GO`
- Timestamp (UTC): `2026-03-04T03:11:39Z`
- Notes: `P0 complete. DNS/TLS verified on myhomeinventory.net + www. Auth hardening complete. Backup/restore drill and monitoring validated.`
