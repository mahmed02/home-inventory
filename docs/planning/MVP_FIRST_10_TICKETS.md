# Next 7 MVP Tickets (AWS Track)

This replaces the previous first-10 list. These are the immediate execution tickets for hardening MVP on the AWS stack.

## 1) Hosting Decision Lock + AWS Baseline
Status: `done`
- Scope:
  - Lock hosting target to AWS (`EC2/Amplify + RDS Postgres + S3 + ACM`).
  - Define required env vars for local/staging/prod.
- Acceptance:
  - AWS selected and documented as target architecture.
  - `/Users/mohammedahmed/MyProjects/home_inventory/api/README.md` includes deploy env table.
  - `/Users/mohammedahmed/MyProjects/home_inventory/api/.env.example` includes production-required vars.

## 2) Lint/Format + CI Gate
Status: `done`
- Scope:
  - Add ESLint + Prettier for `api/`.
  - Add CI workflow to run `typecheck` and `lint`.
- Acceptance:
  - `npm --prefix ./api run lint` exists and passes.
  - CI fails on lint/typecheck regressions.

## 3) Migration Constraint Test (`locations.code` uniqueness)
Status: `done`
- Scope:
  - Add DB-level test proving duplicate non-null `locations.code` is rejected.
- Acceptance:
  - Automated test fails if unique index is removed.
  - Test runs in current contract test flow.

## 4) API Test Coverage Expansion
Status: `done`
- Scope:
  - Add contract tests for:
    - `GET /locations/:id/path`
    - delete edge cases (`404`, guarded `409`, success `204`)
    - invalid UUID validation paths.
- Acceptance:
  - New tests pass and cover all listed behaviors.

## 5) `/dev/seed` Guardrail Test
Status: `done`
- Scope:
  - Add test proving `/dev/seed` returns `403` when `ENABLE_DEV_ROUTES=false`.
- Acceptance:
  - Test verifies forbidden behavior.
  - Env state is restored after test run.

## 6) Siri Shortcut Setup Doc
Status: `done`
- Scope:
  - Add step-by-step Siri Shortcut setup using `GET /api/items/lookup?q=`.
  - Include troubleshooting for no-match and network failures.
- Acceptance:
  - A non-technical household member can configure and use the shortcut.

## 7) Breadcrumb UX in Interactive Explorer
Status: `done`
- Scope:
  - Show selected location/item breadcrumb path in tree editor panel.
  - Keep path updated after rename/move and refresh.
- Acceptance:
  - Selecting a node/item always shows its full path.
  - Breadcrumb updates correctly after edits.

---

Execution note:
- Start with tickets `2 + 3 + 4` as the first implementation batch.
