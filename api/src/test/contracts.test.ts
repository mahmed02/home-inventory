import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import path from "node:path";
import test, { after, before, beforeEach } from "node:test";
import dotenv from "dotenv";
import { Pool } from "pg";

type AppModule = typeof import("../app");
type MigrationsModule = typeof import("../db/migrations");

const testEnvPath = path.resolve(__dirname, "../../.env.test");
const defaultEnvPath = path.resolve(__dirname, "../../.env");

dotenv.config({ path: testEnvPath });
dotenv.config({ path: defaultEnvPath });
process.env.REQUIRE_AUTH = "false";
process.env.REQUIRE_USER_ACCOUNTS = "false";
process.env.AWS_REGION = "";
process.env.S3_BUCKET = "";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (!process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL (or DATABASE_URL) must be set before running tests");
}

if (!process.env.DATABASE_URL.includes("_test")) {
  throw new Error(
    "Refusing to run destructive tests against non-test database. Use a database name ending with '_test'."
  );
}

let baseUrl = "";
let server: ReturnType<AppModule["default"]["listen"]>;
let app: AppModule["default"];
let pool: Pool;
let applyPendingMigrations: MigrationsModule["applyPendingMigrations"];

async function request(
  requestPath: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;

  let json: unknown = parsed;
  if (parsed && typeof parsed === "object" && "ok" in parsed) {
    const envelope = parsed as {
      ok: boolean;
      data?: unknown;
      error?: { message?: string };
    };

    if (envelope.ok) {
      json = envelope.data ?? null;
    } else {
      json = { error: envelope.error?.message ?? "Request failed" };
    }
  }

  return { status: response.status, json };
}

async function resetDatabase(): Promise<void> {
  await pool.query("DROP TABLE IF EXISTS items CASCADE");
  await pool.query("DROP TABLE IF EXISTS locations CASCADE");
  await pool.query("DROP TABLE IF EXISTS household_invitations CASCADE");
  await pool.query("DROP TABLE IF EXISTS household_members CASCADE");
  await pool.query("DROP TABLE IF EXISTS households CASCADE");
  await pool.query("DROP TABLE IF EXISTS password_reset_tokens CASCADE");
  await pool.query("DROP TABLE IF EXISTS user_sessions CASCADE");
  await pool.query("DROP TABLE IF EXISTS users CASCADE");
  await pool.query("DROP TABLE IF EXISTS schema_migrations CASCADE");
  await pool.query("DROP FUNCTION IF EXISTS set_updated_at() CASCADE");
  await applyPendingMigrations();
}

async function clearData(): Promise<void> {
  await pool.query("DELETE FROM items");
  await pool.query("DELETE FROM locations");
  await pool.query("DELETE FROM household_invitations");
  await pool.query("DELETE FROM household_members");
  await pool.query("DELETE FROM households");
  await pool.query("DELETE FROM password_reset_tokens");
  await pool.query("DELETE FROM user_sessions");
  await pool.query("DELETE FROM users");
}

before(async () => {
  const appModule = await import("../app");
  const poolModule = await import("../db/pool");
  const migrationsModule = await import("../db/migrations");

  app = appModule.default;
  pool = poolModule.pool;
  applyPendingMigrations = migrationsModule.applyPendingMigrations;

  await resetDatabase();
  server = app.listen(0);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  await clearData();
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  if (pool) {
    await pool.end();
  }
});

test("POST /locations rejects duplicate non-null code", async () => {
  const first = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(first.status, 201);

  const second = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "H1", type: "room", parent_id: null },
  });

  assert.equal(second.status, 409);
  assert.deepEqual(second.json, { error: "Location code already exists" });
});

test("DB-level unique index rejects duplicate non-null location code", async () => {
  await pool.query(
    `
    INSERT INTO locations(name, code, type, parent_id)
    VALUES ($1, $2, $3, $4)
    `,
    ["House", "H1", "house", null]
  );

  await assert.rejects(
    () =>
      pool.query(
        `
        INSERT INTO locations(name, code, type, parent_id)
        VALUES ($1, $2, $3, $4)
        `,
        ["Garage", "H1", "room", null]
      ),
    (error: { code?: string }) => error.code === "23505"
  );
});

test("PATCH /locations/:id prevents cyclical parent moves", async () => {
  const house = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(house.status, 201);
  const houseId = (house.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: houseId },
  });
  assert.equal(garage.status, 201);
  const garageId = (garage.json as { id: string }).id;

  const shelf = await request("/locations", {
    method: "POST",
    body: { name: "Shelf", code: "S1", type: "shelf", parent_id: garageId },
  });
  assert.equal(shelf.status, 201);
  const shelfId = (shelf.json as { id: string }).id;

  const invalidMove = await request(`/locations/${houseId}`, {
    method: "PATCH",
    body: { parent_id: shelfId },
  });

  assert.equal(invalidMove.status, 400);
  assert.deepEqual(invalidMove.json, {
    error: "Invalid move: would create a cycle",
  });
});

test("GET /locations/:id/path returns breadcrumb path", async () => {
  const house = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  const houseId = (house.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: houseId },
  });
  const garageId = (garage.json as { id: string }).id;

  const shelf = await request("/locations", {
    method: "POST",
    body: { name: "Shelf 2", code: "S2", type: "shelf", parent_id: garageId },
  });
  const shelfId = (shelf.json as { id: string }).id;

  const path = await request(`/locations/${shelfId}/path`);
  assert.equal(path.status, 200);
  assert.deepEqual(path.json, {
    id: shelfId,
    name: "Shelf 2",
    path: "House > Garage > Shelf 2",
  });
});

test("Invalid UUID validation paths return 400", async () => {
  const invalidLocationPath = await request("/locations/not-a-uuid/path");
  assert.equal(invalidLocationPath.status, 400);

  const invalidLocationDelete = await request("/locations/not-a-uuid", {
    method: "DELETE",
  });
  assert.equal(invalidLocationDelete.status, 400);

  const invalidSearchRoot = await request("/locations/tree?root_id=not-a-uuid");
  assert.equal(invalidSearchRoot.status, 400);
});

test("GET /items/search supports pagination and returns paths", async () => {
  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: rootId },
  });
  const garageId = (garage.json as { id: string }).id;

  for (const name of ["Toolbox", "Tool Belt", "Tool Case"]) {
    const item = await request("/items", {
      method: "POST",
      body: {
        name,
        keywords: ["tool"],
        location_id: garageId,
      },
    });
    assert.equal(item.status, 201);
  }

  const page1 = await request("/items/search?q=tool&limit=2&offset=0");
  assert.equal(page1.status, 200);
  const page1Json = page1.json as {
    results: Array<{ id: string; name: string; location_path: string }>;
    total: number;
    limit: number;
    offset: number;
  };

  assert.equal(page1Json.total, 3);
  assert.equal(page1Json.limit, 2);
  assert.equal(page1Json.offset, 0);
  assert.equal(page1Json.results.length, 2);
  assert.match(page1Json.results[0].location_path, /^House > Garage$/);

  const page2 = await request("/items/search?q=tool&limit=2&offset=2");
  assert.equal(page2.status, 200);
  const page2Json = page2.json as {
    results: Array<{ id: string; name: string; location_path: string }>;
    total: number;
  };

  assert.equal(page2Json.total, 3);
  assert.equal(page2Json.results.length, 1);
});

test("GET /api/items/lookup returns Siri response shape", async () => {
  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: rootId },
  });
  const garageId = (garage.json as { id: string }).id;

  const item = await request("/items", {
    method: "POST",
    body: {
      name: "Ryobi Air Compressor",
      description: "Green, under tarp",
      keywords: ["compressor", "air", "green"],
      location_id: garageId,
    },
  });
  assert.equal(item.status, 201);

  const lookup = await request("/api/items/lookup?q=compressor");
  assert.equal(lookup.status, 200);

  const payload = lookup.json as {
    item: string | null;
    location_path: string | null;
    notes: string;
  };

  assert.equal(payload.item, "Ryobi Air Compressor");
  assert.match(payload.location_path ?? "", /^House > Garage$/);
  assert.equal(typeof payload.notes, "string");
});

test("POST /uploads/presign validates request and reports missing config", async () => {
  const missing = await request("/uploads/presign", {
    method: "POST",
    body: { filename: "box.jpg" },
  });
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.json, { error: "filename and content_type are required" });

  const invalidType = await request("/uploads/presign", {
    method: "POST",
    body: { filename: "notes.txt", content_type: "text/plain", scope: "item" },
  });
  assert.equal(invalidType.status, 400);
  assert.deepEqual(invalidType.json, {
    error: "content_type must be one of image/jpeg, image/png, image/webp, image/gif",
  });

  const unconfigured = await request("/uploads/presign", {
    method: "POST",
    body: { filename: "box.jpg", content_type: "image/jpeg", scope: "item" },
  });
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(unconfigured.json, {
    error: "S3 uploads are not configured (AWS_REGION/S3_BUCKET missing)",
  });
});

test("POST /uploads/finalize validates request and reports missing config", async () => {
  const missing = await request("/uploads/finalize", {
    method: "POST",
    body: {},
  });
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.json, { error: "image_url is required" });

  const unconfigured = await request("/uploads/finalize", {
    method: "POST",
    body: {
      image_url: "https://example-bucket.s3.us-east-1.amazonaws.com/item/demo/image.jpg",
    },
  });
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(unconfigured.json, {
    error: "S3 uploads are not configured (AWS_REGION/S3_BUCKET missing)",
  });
});

test("PATCH/DELETE item flow works end-to-end", async () => {
  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: rootId },
  });
  const garageId = (garage.json as { id: string }).id;

  const basement = await request("/locations", {
    method: "POST",
    body: { name: "Basement", code: "B1", type: "room", parent_id: rootId },
  });
  const basementId = (basement.json as { id: string }).id;

  const item = await request("/items", {
    method: "POST",
    body: {
      name: "Impact Driver",
      keywords: ["tool", "driver"],
      location_id: garageId,
    },
  });
  assert.equal(item.status, 201);
  const itemId = (item.json as { id: string }).id;

  const updated = await request(`/items/${itemId}`, {
    method: "PATCH",
    body: {
      name: "Impact Driver M18",
      location_id: basementId,
      keywords: ["tool", "driver", "m18"],
    },
  });
  assert.equal(updated.status, 200);
  const updatedJson = updated.json as {
    name: string;
    location_id: string;
    keywords: string[];
  };
  assert.equal(updatedJson.name, "Impact Driver M18");
  assert.equal(updatedJson.location_id, basementId);
  assert.deepEqual(updatedJson.keywords, ["tool", "driver", "m18"]);

  const deleted = await request(`/items/${itemId}`, { method: "DELETE" });
  assert.equal(deleted.status, 204);

  const afterDelete = await request(`/items/${itemId}`);
  assert.equal(afterDelete.status, 404);
});

test("DELETE /locations enforces child/item guard", async () => {
  const house = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  const houseId = (house.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: houseId },
  });
  const garageId = (garage.json as { id: string }).id;

  const item = await request("/items", {
    method: "POST",
    body: { name: "Ladder", keywords: ["ladder"], location_id: garageId },
  });
  assert.equal(item.status, 201);
  const itemId = (item.json as { id: string }).id;

  const blockedByChild = await request(`/locations/${houseId}`, { method: "DELETE" });
  assert.equal(blockedByChild.status, 409);

  const blockedByItem = await request(`/locations/${garageId}`, { method: "DELETE" });
  assert.equal(blockedByItem.status, 409);

  const deletedItem = await request(`/items/${itemId}`, { method: "DELETE" });
  assert.equal(deletedItem.status, 204);

  const deletedGarage = await request(`/locations/${garageId}`, { method: "DELETE" });
  assert.equal(deletedGarage.status, 204);

  const deletedHouse = await request(`/locations/${houseId}`, { method: "DELETE" });
  assert.equal(deletedHouse.status, 204);
});

test("DELETE endpoints return 404 when target does not exist", async () => {
  const missingLocation = await request("/locations/11111111-1111-4111-8111-111111111111", {
    method: "DELETE",
  });
  assert.equal(missingLocation.status, 404);

  const missingItem = await request("/items/11111111-1111-4111-8111-111111111111", {
    method: "DELETE",
  });
  assert.equal(missingItem.status, 404);
});

test("POST /dev/seed returns 403 when ENABLE_DEV_ROUTES=false", async () => {
  const previousEnableDevRoutes = process.env.ENABLE_DEV_ROUTES;

  try {
    process.env.ENABLE_DEV_ROUTES = "false";
    const seeded = await request("/dev/seed", { method: "POST" });
    assert.equal(seeded.status, 403);
    assert.deepEqual(seeded.json, { error: "Dev routes are disabled" });
  } finally {
    if (previousEnableDevRoutes === undefined) {
      delete process.env.ENABLE_DEV_ROUTES;
    } else {
      process.env.ENABLE_DEV_ROUTES = previousEnableDevRoutes;
    }
  }
});

test("GET /export/inventory returns backup payload", async () => {
  const house = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  const houseId = (house.json as { id: string }).id;

  const item = await request("/items", {
    method: "POST",
    body: { name: "Flashlight", keywords: ["light"], location_id: houseId },
  });
  assert.equal(item.status, 201);

  const exported = await request("/export/inventory");
  assert.equal(exported.status, 200);

  const payload = exported.json as {
    exported_at: string;
    version: number;
    counts: { locations: number; items: number };
    locations: unknown[];
    items: unknown[];
  };

  assert.equal(payload.version, 1);
  assert.ok(typeof payload.exported_at === "string");
  assert.equal(payload.counts.locations, 1);
  assert.equal(payload.counts.items, 1);
  assert.equal(payload.locations.length, 1);
  assert.equal(payload.items.length, 1);
});

test("POST /import/inventory restores exported snapshot", async () => {
  const house = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  const houseId = (house.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: houseId },
  });
  const garageId = (garage.json as { id: string }).id;

  const createdItem = await request("/items", {
    method: "POST",
    body: {
      name: "Air Pump",
      keywords: ["air", "pump"],
      location_id: garageId,
    },
  });
  assert.equal(createdItem.status, 201);

  const exported = await request("/export/inventory");
  assert.equal(exported.status, 200);
  const backup = exported.json as {
    locations: unknown[];
    items: unknown[];
  };

  await request("/items", {
    method: "POST",
    body: {
      name: "Temporary Item",
      keywords: ["temp"],
      location_id: houseId,
    },
  });

  const imported = await request("/import/inventory", {
    method: "POST",
    body: backup,
  });
  assert.equal(imported.status, 200);

  const after = await request("/export/inventory");
  assert.equal(after.status, 200);
  const afterPayload = after.json as {
    counts: { locations: number; items: number };
    items: Array<{ name: string }>;
  };

  assert.equal(afterPayload.counts.locations, 2);
  assert.equal(afterPayload.counts.items, 1);
  assert.equal(afterPayload.items[0].name, "Air Pump");
});

test("POST /import/inventory?validate_only=true validates without mutating data", async () => {
  const house = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  const houseId = (house.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: houseId },
  });
  const garageId = (garage.json as { id: string }).id;

  await request("/items", {
    method: "POST",
    body: {
      name: "Air Pump",
      keywords: ["air", "pump"],
      location_id: garageId,
    },
  });

  const backup = await request("/export/inventory");
  const snapshot = backup.json as { locations: unknown[]; items: unknown[] };

  const extra = await request("/locations", {
    method: "POST",
    body: { name: "Attic", code: "A1", type: "room", parent_id: houseId },
  });
  assert.equal(extra.status, 201);

  const validated = await request("/import/inventory?validate_only=true", {
    method: "POST",
    body: snapshot,
  });
  assert.equal(validated.status, 200);
  assert.deepEqual(validated.json, {
    valid: true,
    mode: "validate-replace",
    counts: { locations: 2, items: 1 },
  });

  const after = await request("/export/inventory");
  const afterJson = after.json as { counts: { locations: number; items: number } };
  assert.equal(afterJson.counts.locations, 3);
  assert.equal(afterJson.counts.items, 1);
});

test("POST /import/inventory?remap_ids=true merges payload into non-empty inventory", async () => {
  const existing = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(existing.status, 201);

  const imported = await request("/import/inventory?remap_ids=true", {
    method: "POST",
    body: {
      locations: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Garage",
          code: "H1",
          type: "room",
          parent_id: null,
          description: null,
          image_url: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Compressor",
          description: "Green",
          keywords: ["air", "compressor"],
          location_id: "11111111-1111-4111-8111-111111111111",
          image_url: null,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(imported.status, 200);
  assert.deepEqual(imported.json, {
    imported: true,
    mode: "merge-remap",
    counts: { locations: 1, items: 1 },
  });

  const exported = await request("/export/inventory");
  const payload = exported.json as {
    counts: { locations: number; items: number };
    locations: Array<{ code: string | null }>;
    items: Array<{ name: string }>;
  };

  assert.equal(payload.counts.locations, 2);
  assert.equal(payload.counts.items, 1);
  assert.equal(payload.items[0].name, "Compressor");

  const nonNullCodes = payload.locations
    .map((location) => location.code)
    .filter((code): code is string => Boolean(code));
  assert.equal(new Set(nonNullCodes).size, nonNullCodes.length);
  assert.ok(nonNullCodes.includes("H1"));
  assert.ok(nonNullCodes.some((code) => code.startsWith("H1-import-")));
});

test("Auth register/login/logout flow issues and revokes bearer sessions", async () => {
  const registered = await request("/auth/register", {
    method: "POST",
    body: {
      email: "owner1@example.com",
      password: "SuperSecret123!",
      display_name: "Owner One",
    },
  });
  assert.equal(registered.status, 201);
  const registerJson = registered.json as {
    user: { id: string; email: string; display_name: string | null };
    token: string;
    expires_at: string;
  };

  assert.equal(registerJson.user.email, "owner1@example.com");
  assert.equal(registerJson.user.display_name, "Owner One");
  assert.ok(registerJson.token.length > 20);
  assert.ok(typeof registerJson.expires_at === "string");

  const me = await request("/auth/me", { token: registerJson.token });
  assert.equal(me.status, 200);

  const loggedOut = await request("/auth/logout", {
    method: "POST",
    token: registerJson.token,
  });
  assert.equal(loggedOut.status, 200);
  assert.deepEqual(loggedOut.json, { logged_out: true });

  const meAfterLogout = await request("/auth/me", { token: registerJson.token });
  assert.equal(meAfterLogout.status, 401);

  const loggedIn = await request("/auth/login", {
    method: "POST",
    body: { email: "owner1@example.com", password: "SuperSecret123!" },
  });
  assert.equal(loggedIn.status, 200);
  const loginJson = loggedIn.json as { token: string; user: { email: string } };
  assert.equal(loginJson.user.email, "owner1@example.com");
  assert.ok(loginJson.token.length > 20);
});

test("Password reset flow issues one-time token and rotates credentials", async () => {
  const registered = await request("/auth/register", {
    method: "POST",
    body: {
      email: "reset-user@example.com",
      password: "OldPassword123!",
    },
  });
  assert.equal(registered.status, 201);

  const forgot = await request("/auth/forgot-password", {
    method: "POST",
    body: { email: "reset-user@example.com" },
  });
  assert.equal(forgot.status, 200);

  const forgotJson = forgot.json as {
    accepted: boolean;
    reset_token: string | null;
    expires_at: string | null;
  };
  assert.equal(forgotJson.accepted, true);
  assert.ok(typeof forgotJson.reset_token === "string" && forgotJson.reset_token.length > 20);
  assert.ok(typeof forgotJson.expires_at === "string");

  const reset = await request("/auth/reset-password", {
    method: "POST",
    body: { token: forgotJson.reset_token, new_password: "NewPassword123!" },
  });
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.json, { reset: true });

  const reused = await request("/auth/reset-password", {
    method: "POST",
    body: { token: forgotJson.reset_token, new_password: "AnotherPassword123!" },
  });
  assert.equal(reused.status, 400);

  const loginOld = await request("/auth/login", {
    method: "POST",
    body: { email: "reset-user@example.com", password: "OldPassword123!" },
  });
  assert.equal(loginOld.status, 401);

  const loginNew = await request("/auth/login", {
    method: "POST",
    body: { email: "reset-user@example.com", password: "NewPassword123!" },
  });
  assert.equal(loginNew.status, 200);
});

test("Owner-scoped access isolates inventory across users", async () => {
  const user1 = await request("/auth/register", {
    method: "POST",
    body: { email: "user1@example.com", password: "SuperSecret123!" },
  });
  assert.equal(user1.status, 201);
  const user1Token = (user1.json as { token: string }).token;

  const user2 = await request("/auth/register", {
    method: "POST",
    body: { email: "user2@example.com", password: "SuperSecret123!" },
  });
  assert.equal(user2.status, 201);
  const user2Token = (user2.json as { token: string }).token;

  const root = await request("/locations", {
    method: "POST",
    token: user1Token,
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const user2Root = await request("/locations", {
    method: "POST",
    token: user2Token,
    body: { name: "Apartment", code: "H1", type: "home", parent_id: null },
  });
  assert.equal(user2Root.status, 201);

  const createdItem = await request("/items", {
    method: "POST",
    token: user1Token,
    body: {
      name: "Pressure Washer",
      keywords: ["tool", "washer"],
      location_id: rootId,
    },
  });
  assert.equal(createdItem.status, 201);
  const itemId = (createdItem.json as { id: string }).id;

  const user1GetsItem = await request(`/items/${itemId}`, { token: user1Token });
  assert.equal(user1GetsItem.status, 200);

  const user2GetsItem = await request(`/items/${itemId}`, { token: user2Token });
  assert.equal(user2GetsItem.status, 404);

  const anonymousGetsItem = await request(`/items/${itemId}`);
  assert.equal(anonymousGetsItem.status, 404);

  const user2Search = await request("/items/search?q=pressure&limit=10&offset=0", {
    token: user2Token,
  });
  assert.equal(user2Search.status, 200);
  const user2SearchJson = user2Search.json as { total: number };
  assert.equal(user2SearchJson.total, 0);

  const user2CannotCreateInUser1Location = await request("/items", {
    method: "POST",
    token: user2Token,
    body: {
      name: "Cross Tenant Item",
      keywords: ["blocked"],
      location_id: rootId,
    },
  });
  assert.equal(user2CannotCreateInUser1Location.status, 404);

  const user2Tree = await request("/inventory/tree", { token: user2Token });
  assert.equal(user2Tree.status, 200);
  const user2TreeJson = user2Tree.json as { total_locations: number; total_items: number };
  assert.equal(user2TreeJson.total_locations, 1);
  assert.equal(user2TreeJson.total_items, 0);

  const user1Export = await request("/export/inventory", { token: user1Token });
  assert.equal(user1Export.status, 200);
  const user1ExportJson = user1Export.json as { counts: { locations: number; items: number } };
  assert.equal(user1ExportJson.counts.locations, 1);
  assert.equal(user1ExportJson.counts.items, 1);

  const user2Export = await request("/export/inventory", { token: user2Token });
  assert.equal(user2Export.status, 200);
  const user2ExportJson = user2Export.json as { counts: { locations: number; items: number } };
  assert.equal(user2ExportJson.counts.locations, 1);
  assert.equal(user2ExportJson.counts.items, 0);
});

test("Household invite acceptance enforces owner controls and email matching", async () => {
  const owner = await request("/auth/register", {
    method: "POST",
    body: { email: "hh-owner@example.com", password: "SuperSecret123!" },
  });
  assert.equal(owner.status, 201);
  const ownerToken = (owner.json as { token: string }).token;

  const invitee = await request("/auth/register", {
    method: "POST",
    body: { email: "hh-invitee@example.com", password: "SuperSecret123!" },
  });
  assert.equal(invitee.status, 201);
  const inviteeToken = (invitee.json as { token: string }).token;

  const outsider = await request("/auth/register", {
    method: "POST",
    body: { email: "hh-outsider@example.com", password: "SuperSecret123!" },
  });
  assert.equal(outsider.status, 201);
  const outsiderToken = (outsider.json as { token: string }).token;

  const ownerHouseholds = await request("/households", { token: ownerToken });
  assert.equal(ownerHouseholds.status, 200);
  const ownerHouseholdsJson = ownerHouseholds.json as {
    households: Array<{ id: string; role: string }>;
  };
  assert.equal(ownerHouseholdsJson.households.length, 1);
  assert.equal(ownerHouseholdsJson.households[0].role, "owner");
  const householdId = ownerHouseholdsJson.households[0].id;

  const nonMemberInviteAttempt = await request(`/households/${householdId}/invitations`, {
    method: "POST",
    token: inviteeToken,
    body: { email: "someone@example.com", role: "viewer" },
  });
  assert.equal(nonMemberInviteAttempt.status, 404);

  const invite = await request(`/households/${householdId}/invitations`, {
    method: "POST",
    token: ownerToken,
    body: { email: "hh-invitee@example.com", role: "editor" },
  });
  assert.equal(invite.status, 201);
  const inviteJson = invite.json as {
    invitation: { id: string; household_id: string; email: string; role: string };
    invitation_token: string;
  };
  assert.equal(inviteJson.invitation.household_id, householdId);
  assert.equal(inviteJson.invitation.email, "hh-invitee@example.com");
  assert.equal(inviteJson.invitation.role, "editor");
  assert.ok(inviteJson.invitation_token.length > 20);

  const duplicateInvite = await request(`/households/${householdId}/invitations`, {
    method: "POST",
    token: ownerToken,
    body: { email: "hh-invitee@example.com", role: "viewer" },
  });
  assert.equal(duplicateInvite.status, 409);

  const outsiderAccept = await request("/households/invitations/accept", {
    method: "POST",
    token: outsiderToken,
    body: { token: inviteJson.invitation_token },
  });
  assert.equal(outsiderAccept.status, 403);

  const inviteeAccept = await request("/households/invitations/accept", {
    method: "POST",
    token: inviteeToken,
    body: { token: inviteJson.invitation_token },
  });
  assert.equal(inviteeAccept.status, 200);
  assert.deepEqual(inviteeAccept.json, {
    accepted: true,
    household_id: householdId,
    role: "editor",
  });

  const ownerMembers = await request(`/households/${householdId}/members`, { token: ownerToken });
  assert.equal(ownerMembers.status, 200);
  const ownerMembersJson = ownerMembers.json as {
    members: Array<{ email: string; role: string }>;
  };
  assert.equal(ownerMembersJson.members.length, 2);
  assert.ok(
    ownerMembersJson.members.some(
      (member) => member.email === "hh-invitee@example.com" && member.role === "editor"
    )
  );

  const editorCannotInvite = await request(`/households/${householdId}/invitations`, {
    method: "POST",
    token: inviteeToken,
    body: { email: "editor-cannot@example.com", role: "viewer" },
  });
  assert.equal(editorCannotInvite.status, 403);
});

test("Household invitation revoke invalidates pending token", async () => {
  const owner = await request("/auth/register", {
    method: "POST",
    body: { email: "hh-revoke-owner@example.com", password: "SuperSecret123!" },
  });
  assert.equal(owner.status, 201);
  const ownerToken = (owner.json as { token: string }).token;

  const invitee = await request("/auth/register", {
    method: "POST",
    body: { email: "hh-revoke-invitee@example.com", password: "SuperSecret123!" },
  });
  assert.equal(invitee.status, 201);
  const inviteeToken = (invitee.json as { token: string }).token;

  const ownerHouseholds = await request("/households", { token: ownerToken });
  assert.equal(ownerHouseholds.status, 200);
  const householdId = (ownerHouseholds.json as { households: Array<{ id: string }> }).households[0]
    .id;

  const invite = await request(`/households/${householdId}/invitations`, {
    method: "POST",
    token: ownerToken,
    body: { email: "hh-revoke-invitee@example.com", role: "viewer" },
  });
  assert.equal(invite.status, 201);
  const inviteJson = invite.json as {
    invitation: { id: string };
    invitation_token: string;
  };

  const revoked = await request(
    `/households/${householdId}/invitations/${inviteJson.invitation.id}`,
    {
      method: "DELETE",
      token: ownerToken,
    }
  );
  assert.equal(revoked.status, 200);
  assert.deepEqual(revoked.json, { revoked: true });

  const acceptRevoked = await request("/households/invitations/accept", {
    method: "POST",
    token: inviteeToken,
    body: { token: inviteJson.invitation_token },
  });
  assert.equal(acceptRevoked.status, 400);
  assert.deepEqual(acceptRevoked.json, { error: "Invalid or expired invitation token" });
});
