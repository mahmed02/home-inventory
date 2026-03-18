# ADR 0002: Household Sharing Model

Date: 2026-02-23
Status: Accepted

## Context

Phase 6.5 introduced account-level ownership (`owner_user_id`) and user-scoped inventory isolation.
Next, the product needs collaborative access where one owner can invite others to the same home inventory.

## Decision

1. Introduce a household collaboration domain:
   - `households`
   - `household_members`
   - `household_invitations`
2. Keep `owner_user_id` during transition, and add `household_id` linkage on inventory entities.
3. Use role-based household membership:
   - `owner`
   - `editor`
   - `viewer`
4. Use invitation tokens (stored hashed) for acceptance flow.

## Role Matrix (Target Behavior)

1. `owner`
   - Can invite/revoke members.
   - Can change member roles.
   - Can read/write all inventory data in household.
2. `editor`
   - Can read/write inventory data.
   - Cannot manage household membership.
3. `viewer`
   - Read-only access.
   - Cannot mutate inventory.

## Endpoint Policy Matrix (Phase 6.6 Target)

1. `POST /households/:id/invitations`: owner only
2. `DELETE /households/:id/invitations/:invitationId`: owner only
3. `POST /households/invitations/accept`: authenticated invited user
4. Inventory write endpoints (`POST/PATCH/DELETE`): owner/editor only
5. Inventory read endpoints (`GET`): owner/editor/viewer

## Migration Strategy

1. Create household tables and add `household_id` columns to `locations` and `items`.
2. Backfill one default household per existing user.
3. Backfill household linkage on inventory rows from current `owner_user_id`.
4. Keep owner-scoped query path active until full household-scope refactor is complete.
5. In a later phase, migrate runtime authorization to household role checks and retire direct owner-only scope.

## Security Notes

1. Invitation and reset/session tokens are stored hashed server-side.
2. Invitations are time-bound and one-time use.
3. Accept flow validates invited email against authenticated account email.

## Consequences

Positive:
1. Enables shared home inventories while preserving authorization boundaries.
2. Supports staged rollout without breaking existing owner-scoped APIs.

Tradeoffs:
1. Temporary dual model (`owner_user_id` + `household_id`) increases schema complexity.
2. Full role-based enforcement requires follow-up refactor across all inventory routes.
