# Home Inventory Mobile (Phase 11 Bootstrap)

This folder is the initial mobile bootstrap for ticket `11-01`.

## Stack

- React Native + Expo
- TypeScript

## Quick Start

1. Install dependencies:
   - `npm --prefix ./mobile install`
2. Copy env template:
   - `cp ./mobile/.env.example ./mobile/.env`
3. Start Metro:
   - `npm --prefix ./mobile run start`

## Runtime Config

Mobile config values are injected through Expo `extra` in `/Users/mohammedahmed/MyProjects/home_inventory/mobile/app.config.ts`:

- `MOBILE_API_BASE_URL`
- `MOBILE_ENVIRONMENT`
- `MOBILE_REQUIRE_USER_ACCOUNTS`

The app reads config in `/Users/mohammedahmed/MyProjects/home_inventory/mobile/src/config/env.ts`.

## Scope of This Bootstrap

- Verifies baseline iOS/Android project wiring.
- Exposes runtime config surface for upcoming API/auth integration (`11-02`).
- Keeps storage layer unimplemented until local-only mode work (`11-03`).
