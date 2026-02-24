# ADR 0003: Mobile App Architecture + Bootstrap

Date: 2026-02-24
Status: Accepted

## Context

Phase 11 requires a mobile client that can support both:
1. Cloud-synced household inventories
2. Local-only inventory mode for offline-first personal usage

The current backend is TypeScript/Node with account and household auth already in place.

## Decision

1. Use React Native with Expo (TypeScript) for mobile bootstrap.
2. Keep a shared API contract layer in TypeScript so mobile and web can align on request/response shapes.
3. Use runtime mobile config via Expo `extra` values:
   - `apiBaseUrl`
   - `environment`
   - `requireUserAccounts`
4. Keep storage strategy behind repository interfaces:
   - cloud-backed repository (Phase 11-02)
   - local-only repository (Phase 11-03)

## Why This Model

1. Expo accelerates iOS/Android dev setup and onboarding.
2. TypeScript aligns with the existing API stack and reduces translation overhead.
3. Runtime config avoids hardcoding staging/prod endpoints in mobile source.
4. Repository abstraction keeps local-only mode and cloud mode swappable without UI rewrites.

## Initial App Boundaries

1. `mobile/src/config/env.ts`
   - Runtime config access and defaults.
2. `mobile/App.tsx`
   - Bootstrap shell surface for environment + auth mode visibility.
3. Next phases:
   - `11-02`: typed API client + auth session integration.
   - `11-03`: local data layer and mode selection.

## Security Baseline (Phase 11 Scope)

1. No static secrets in app source.
2. Auth/session secrets will use secure device storage in follow-up tickets.
3. API base URL is runtime-configurable per environment.

## Consequences

Positive:
1. Immediate cross-platform mobile bootstrap with low setup friction.
2. Clear path to incremental cloud/local mode rollout.

Tradeoffs:
1. Expo package versioning must stay aligned over time.
2. Native-module edge cases may require prebuild/eject decisions later.

## Follow-up

1. Implement `11-02` shared API client + auth wiring.
2. Implement `11-03` local-only repository and export/import.
3. Add offline queue/reconciliation in `11-04`.
