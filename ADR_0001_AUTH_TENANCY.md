# ADR 0001: Auth + Tenancy Model

Date: 2026-02-23
Status: Accepted

## Context

The MVP uses optional environment-level HTTP Basic auth for whole-app access.  
Post-MVP requires individual accounts and isolated inventories per user.

## Decision

1. Use application-level accounts with email/password.
2. Use server-stored session tokens (opaque bearer token), not client-signed JWT, for the first rollout.
3. Use single-tenant-per-user ownership in the data model via `owner_user_id` on inventory tables.
4. Keep existing Basic auth as an optional edge gate for staging/prod hardening.

## Why This Model

1. Opaque sessions can be revoked immediately (`logout` and forced invalidation) without JWT rotation complexity.
2. Ownership scoping (`owner_user_id`) keeps queries explicit and easy to audit.
3. This minimizes migration risk from single-user MVP while enabling full account isolation.

## Data Model

1. `users`: account identity and password hash.
2. `user_sessions`: token hash, expiry, revocation.
3. `locations.owner_user_id`: nullable foreign key to `users.id`.
4. `items.owner_user_id`: nullable foreign key to `users.id`.

## API/Auth Rollout Order

1. Ship registration/login/logout/me endpoints.
2. Attach request user from bearer session token.
3. Scope all inventory reads/writes by owner.
4. Add authorization tests for cross-user denial.
5. Add optional strict mode (`REQUIRE_USER_ACCOUNTS=true`) to force user auth globally (except health/auth routes).

## Security Notes

1. Passwords are stored as salted `scrypt` hashes.
2. Session tokens are stored hashed (SHA-256) server-side.
3. Session expiry is configurable (`SESSION_TTL_HOURS`).
4. Basic auth can remain enabled as a second gate in staging/production.

## Consequences

Positive:
1. Immediate per-user data isolation.
2. Session revocation support without token blacklist complexity.
3. Low operational overhead and easy local development.

Tradeoffs:
1. Every authenticated request checks session state in the database.
2. Existing legacy rows without owner remain in a compatibility scope until bootstrap migration is completed.

## Follow-up

1. Implement legacy bootstrap migration to assign existing data to a seed owner account.
2. Evaluate optional managed auth provider once product requirements grow (social login, MFA, org-level tenants).
