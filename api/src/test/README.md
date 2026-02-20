# API Contract Tests

These tests validate MVP API behavior:

- Unique location code conflicts
- Cycle prevention on location moves
- Search pagination and location paths
- Siri lookup response shape

## Test DB Safety

Tests are destructive. They drop and recreate schema objects.

- Set `TEST_DATABASE_URL` to a dedicated test DB.
- Database name must include `_test` (guard rail in test suite).

## Run

1. Create test env file from root or api directory:
   - `cp ./api/.env.test.example ./api/.env.test`
2. Create test database (once):
   - `docker exec -it home_inventory_postgres createdb -U postgres home_inventory_test`
3. Run tests:
   - `npm --prefix ./api test`
