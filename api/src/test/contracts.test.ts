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
  } = {}
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json" },
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
  await pool.query("DROP TABLE IF EXISTS schema_migrations CASCADE");
  await pool.query("DROP FUNCTION IF EXISTS set_updated_at() CASCADE");
  await applyPendingMigrations();
}

async function clearData(): Promise<void> {
  await pool.query("DELETE FROM items");
  await pool.query("DELETE FROM locations");
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
