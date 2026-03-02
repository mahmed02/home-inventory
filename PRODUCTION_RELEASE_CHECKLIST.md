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
- [ ] `EMAIL_PROVIDER=resend` configured in production env
- [ ] `EMAIL_FROM` uses verified sender domain
- [ ] `EMAIL_RESEND_API_KEY` valid in runtime process
- [ ] Forgot-password sends to real inbox
- [ ] Verify-email sends to real inbox
- [ ] Household invite sends to real inbox
- [ ] No `delivery":"failed"` in API responses during smoke

Evidence:
- `pm2 logs home-inventory-api --lines 200`
- Curl/API response samples: `________________________________________`

### P0-02) Auth posture for public users is correct
- [ ] `REQUIRE_AUTH=false` (no basic-auth wall for customers)
- [ ] `REQUIRE_USER_ACCOUNTS=true`
- [ ] `SESSION_TRANSPORT=hybrid` (or `cookie`, if chosen)
- [ ] `SESSION_COOKIE_SECURE=true`
- [ ] `SESSION_COOKIE_SAME_SITE=lax` (or stricter if intended)
- [ ] Register/login/logout works from browser
- [ ] Password reset flow end-to-end works

Evidence:
- Env snapshot (`pm2 env 0` selected vars): `_______________________`
- Browser + curl validation notes: `________________________________`

### P0-03) Secrets are rotated after prior exposure risk
- [ ] DB credential rotated
- [ ] AWS credentials/role keys rotated (if any static keys used)
- [ ] Resend API key rotated
- [ ] Any leaked tokens/passwords invalidated
- [ ] Local secret files confirmed not tracked by git

Evidence:
- Rotation date/time (UTC): `__________________`
- Rotation runbook/notes: `________________________________________`

### P0-04) Backup and restore are proven
- [ ] Scheduled backup job enabled (daily minimum)
- [ ] Retention policy set (recommended 14+ days)
- [ ] Latest backup artifact verified
- [ ] Restore drill executed successfully (validate or merge mode minimum)
- [ ] Recovery steps documented with real timings

Commands:
- `BASE_URL=https://<prod-domain> ./scripts/backup.sh`
- `BASE_URL=https://<prod-domain> ./scripts/restore-drill.sh`
- `BASE_URL=https://<prod-domain> AUTH_EMAIL=<account_email> AUTH_PASSWORD=<account_password> HOUSEHOLD_ID=<household_id> ./scripts/backup.sh`
- `BASE_URL=https://<prod-domain> AUTH_EMAIL=<account_email> AUTH_PASSWORD=<account_password> HOUSEHOLD_ID=<household_id> ./scripts/restore-drill.sh`

Evidence:
- Last backup file: `__________________`
- Restore drill result/time: `__________________`

### P0-05) Monitoring and alerting are in place
- [ ] External uptime check for `/health`
- [ ] Alerting for process down / 5xx / high error rate
- [ ] Access to Nginx + API logs
- [ ] On-call contact for launch window

Evidence:
- Monitoring tool(s): `__________________`
- Alert channel: `__________________`

### P0-06) Release + rollback path is proven
- [ ] GitHub Actions deploy to production path confirmed
- [ ] Production environment approval gate enabled
- [ ] Known-good rollback commit identified
- [ ] Rollback command/procedure tested in staging with smoke pass

Evidence:
- Rollback ref: `__________________`
- Last rollback rehearsal: `__________________`

### P0-07) Production DNS/TLS/cutover is complete
- [ ] Production DNS record points to correct target
- [ ] TLS cert valid and auto-renewing
- [ ] `APP_BASE_URL` set to production HTTPS URL
- [ ] CORS allowlist is production-safe
- [ ] `/health` returns 200 over HTTPS

Evidence:
- `curl -sv https://<prod-domain>/health`
- Cert validity dates: `__________________`

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

- [ ] Engineering sign-off
- [ ] Operations sign-off
- [ ] Product sign-off
- [ ] Go/No-Go recorded

Decision:
- `GO` / `NO-GO`
- Timestamp (UTC): `__________________`
- Notes: `____________________________________________________________`
