import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import path from "node:path";
import { URL } from "node:url";
import test, { after, before, beforeEach } from "node:test";
import dotenv from "dotenv";
import { Pool } from "pg";

type AppModule = typeof import("../app");
type MigrationsModule = typeof import("../db/migrations");
type RedirectMode = "follow" | "error" | "manual";

const testEnvPath = path.resolve(__dirname, "../../.env.test");
const defaultEnvPath = path.resolve(__dirname, "../../.env");

dotenv.config({ path: testEnvPath });
dotenv.config({ path: defaultEnvPath });
process.env.REQUIRE_AUTH = "false";
process.env.REQUIRE_USER_ACCOUNTS = "false";
process.env.AWS_REGION = "";
process.env.S3_BUCKET = "";
process.env.SEARCH_PROVIDER = process.env.SEARCH_PROVIDER ?? "memory";

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
    redirect?: RedirectMode;
  } = {}
): Promise<{ status: number; json: unknown; headers: { get(name: string): string | null } }> {
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
    redirect: options.redirect,
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = text;
    }
  }

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

  return { status: response.status, json, headers: response.headers };
}

async function resetDatabase(): Promise<void> {
  await pool.query("DROP TABLE IF EXISTS semantic_search_cache CASCADE");
  await pool.query("DROP TABLE IF EXISTS siri_idempotency_keys CASCADE");
  await pool.query("DROP TABLE IF EXISTS movement_history CASCADE");
  await pool.query("DROP TABLE IF EXISTS item_embeddings CASCADE");
  await pool.query("DROP TABLE IF EXISTS items CASCADE");
  await pool.query("DROP TABLE IF EXISTS location_qr_codes CASCADE");
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
  await pool.query("DELETE FROM semantic_search_cache");
  await pool.query("DELETE FROM siri_idempotency_keys");
  await pool.query("DELETE FROM movement_history");
  await pool.query("DELETE FROM item_embeddings");
  await pool.query("DELETE FROM items");
  await pool.query("DELETE FROM location_qr_codes");
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

test("GET /locations/:id/qr returns stable QR reference payload", async () => {
  const house = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(house.status, 201);
  const houseId = (house.json as { id: string }).id;

  const firstQr = await request(`/locations/${houseId}/qr`);
  assert.equal(firstQr.status, 200);
  const firstQrJson = firstQr.json as {
    location_id: string;
    location_name: string;
    qr_code: string;
    scan_path: string;
    scan_url: string;
    payload: string;
    created_at: string | Date;
    updated_at: string;
  };

  assert.equal(firstQrJson.location_id, houseId);
  assert.equal(firstQrJson.location_name, "House");
  assert.match(
    firstQrJson.qr_code,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  assert.equal(firstQrJson.scan_path, `/scan/location/${firstQrJson.qr_code}`);
  assert.equal(firstQrJson.payload, firstQrJson.scan_url);
  assert.equal(new URL(firstQrJson.scan_url).pathname, firstQrJson.scan_path);
  assert.ok(typeof firstQrJson.created_at === "string");
  assert.ok(typeof firstQrJson.updated_at === "string");

  const secondQr = await request(`/locations/${houseId}/qr`);
  assert.equal(secondQr.status, 200);
  const secondQrJson = secondQr.json as { qr_code: string; scan_url: string };
  assert.equal(secondQrJson.qr_code, firstQrJson.qr_code);
  assert.equal(secondQrJson.scan_url, firstQrJson.scan_url);

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: houseId },
  });
  assert.equal(garage.status, 201);
  const garageId = (garage.json as { id: string }).id;

  const garageQr = await request(`/locations/${garageId}/qr`);
  assert.equal(garageQr.status, 200);
  const garageQrJson = garageQr.json as { qr_code: string };
  assert.notEqual(garageQrJson.qr_code, firstQrJson.qr_code);
});

test("GET /locations/:id/qr enforces owner scope", async () => {
  const owner = await request("/auth/register", {
    method: "POST",
    body: { email: "qr-owner@example.com", password: "SuperSecret123!" },
  });
  assert.equal(owner.status, 201);
  const ownerToken = (owner.json as { token: string }).token;

  const outsider = await request("/auth/register", {
    method: "POST",
    body: { email: "qr-outsider@example.com", password: "SuperSecret123!" },
  });
  assert.equal(outsider.status, 201);
  const outsiderToken = (outsider.json as { token: string }).token;

  const ownerRoot = await request("/locations", {
    method: "POST",
    token: ownerToken,
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(ownerRoot.status, 201);
  const ownerRootId = (ownerRoot.json as { id: string }).id;

  const ownerQr = await request(`/locations/${ownerRootId}/qr`, { token: ownerToken });
  assert.equal(ownerQr.status, 200);
  const ownerQrJson = ownerQr.json as { location_id: string };
  assert.equal(ownerQrJson.location_id, ownerRootId);

  const outsiderQr = await request(`/locations/${ownerRootId}/qr`, { token: outsiderToken });
  assert.equal(outsiderQr.status, 404);
  assert.deepEqual(outsiderQr.json, { error: "Location not found" });
});

test("GET /scan/location/:code redirects to scoped location context", async () => {
  const house = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(house.status, 201);
  const houseId = (house.json as { id: string }).id;

  const qr = await request(`/locations/${houseId}/qr`);
  assert.equal(qr.status, 200);
  const qrCode = (qr.json as { qr_code: string }).qr_code;

  const scan = await request(`/scan/location/${qrCode}`, { redirect: "manual" });
  assert.equal(scan.status, 302);
  const locationHeader = scan.headers.get("location");
  assert.equal(
    locationHeader,
    `/?location_id=${encodeURIComponent(houseId)}&scan_code=${encodeURIComponent(qrCode)}`
  );
});

test("GET /scan/location/:code?format=json enforces access scope", async () => {
  const owner = await request("/auth/register", {
    method: "POST",
    body: { email: "scan-owner@example.com", password: "SuperSecret123!" },
  });
  assert.equal(owner.status, 201);
  const ownerToken = (owner.json as { token: string }).token;

  const outsider = await request("/auth/register", {
    method: "POST",
    body: { email: "scan-outsider@example.com", password: "SuperSecret123!" },
  });
  assert.equal(outsider.status, 201);
  const outsiderToken = (outsider.json as { token: string }).token;

  const ownerRoot = await request("/locations", {
    method: "POST",
    token: ownerToken,
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(ownerRoot.status, 201);
  const ownerRootId = (ownerRoot.json as { id: string }).id;

  const ownerQr = await request(`/locations/${ownerRootId}/qr`, { token: ownerToken });
  assert.equal(ownerQr.status, 200);
  const ownerCode = (ownerQr.json as { qr_code: string }).qr_code;

  const ownerScan = await request(`/scan/location/${ownerCode}?format=json`, { token: ownerToken });
  assert.equal(ownerScan.status, 200);
  const ownerScanJson = ownerScan.json as {
    qr_code: string;
    location_id: string;
    path: string;
    scan_path: string;
  };
  assert.equal(ownerScanJson.qr_code, ownerCode);
  assert.equal(ownerScanJson.location_id, ownerRootId);
  assert.match(ownerScanJson.path, /^House$/);
  assert.equal(ownerScanJson.scan_path, `/scan/location/${ownerCode}`);

  const outsiderScan = await request(`/scan/location/${ownerCode}?format=json`, {
    token: outsiderToken,
  });
  assert.equal(outsiderScan.status, 404);
  assert.deepEqual(outsiderScan.json, { error: "Scanned location not found" });
});

test("GET /locations/:id/verification/checklist returns expected subtree items", async () => {
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
    body: { name: "Shelf A", code: "S1", type: "shelf", parent_id: garageId },
  });
  assert.equal(shelf.status, 201);
  const shelfId = (shelf.json as { id: string }).id;

  const attic = await request("/locations", {
    method: "POST",
    body: { name: "Attic", code: "A1", type: "room", parent_id: houseId },
  });
  assert.equal(attic.status, 201);
  const atticId = (attic.json as { id: string }).id;

  const garageItem = await request("/items", {
    method: "POST",
    body: { name: "Drill Driver", keywords: ["tool"], location_id: garageId },
  });
  assert.equal(garageItem.status, 201);

  const shelfItem = await request("/items", {
    method: "POST",
    body: { name: "Socket Set", keywords: ["tool"], location_id: shelfId },
  });
  assert.equal(shelfItem.status, 201);

  const atticItem = await request("/items", {
    method: "POST",
    body: { name: "Holiday Lights", keywords: ["lights"], location_id: atticId },
  });
  assert.equal(atticItem.status, 201);

  const checklist = await request(`/locations/${garageId}/verification/checklist`);
  assert.equal(checklist.status, 200);
  const checklistJson = checklist.json as {
    location: { id: string; name: string; path: string };
    expected_count: number;
    items: Array<{ name: string; location_path: string }>;
  };

  assert.equal(checklistJson.location.id, garageId);
  assert.equal(checklistJson.location.name, "Garage");
  assert.match(checklistJson.location.path, /^House > Garage$/);
  assert.equal(checklistJson.expected_count, 2);
  assert.equal(checklistJson.items.length, 2);
  assert.deepEqual(
    checklistJson.items.map((row) => row.name),
    ["Drill Driver", "Socket Set"]
  );
  assert.deepEqual(
    checklistJson.items.map((row) => row.location_path),
    ["Garage", "Garage > Shelf A"]
  );
});

test("GET /locations/:id/verification/checklist enforces owner scope", async () => {
  const owner = await request("/auth/register", {
    method: "POST",
    body: { email: "verify-owner@example.com", password: "SuperSecret123!" },
  });
  assert.equal(owner.status, 201);
  const ownerToken = (owner.json as { token: string }).token;

  const outsider = await request("/auth/register", {
    method: "POST",
    body: { email: "verify-outsider@example.com", password: "SuperSecret123!" },
  });
  assert.equal(outsider.status, 201);
  const outsiderToken = (outsider.json as { token: string }).token;

  const location = await request("/locations", {
    method: "POST",
    token: ownerToken,
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(location.status, 201);
  const locationId = (location.json as { id: string }).id;

  const ownerChecklist = await request(`/locations/${locationId}/verification/checklist`, {
    token: ownerToken,
  });
  assert.equal(ownerChecklist.status, 200);

  const outsiderChecklist = await request(`/locations/${locationId}/verification/checklist`, {
    token: outsiderToken,
  });
  assert.equal(outsiderChecklist.status, 404);
  assert.deepEqual(outsiderChecklist.json, { error: "Location not found" });
});

test("POST /locations/:id/move-impact previews affected items and paths", async () => {
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

  const attic = await request("/locations", {
    method: "POST",
    body: { name: "Attic", code: "A1", type: "room", parent_id: houseId },
  });
  assert.equal(attic.status, 201);

  const garageItem = await request("/items", {
    method: "POST",
    body: {
      name: "Compressor",
      keywords: ["tool"],
      location_id: garageId,
    },
  });
  assert.equal(garageItem.status, 201);

  const shelfItem = await request("/items", {
    method: "POST",
    body: {
      name: "Wrench Set",
      keywords: ["tool"],
      location_id: shelfId,
    },
  });
  assert.equal(shelfItem.status, 201);

  const unaffectedItem = await request("/items", {
    method: "POST",
    body: {
      name: "Holiday Decor",
      keywords: ["seasonal"],
      location_id: (attic.json as { id: string }).id,
    },
  });
  assert.equal(unaffectedItem.status, 201);

  const impact = await request(`/locations/${garageId}/move-impact`, {
    method: "POST",
    body: { parent_id: null },
  });
  assert.equal(impact.status, 200);

  const impactJson = impact.json as {
    location_id: string;
    from_parent_id: string | null;
    to_parent_id: string | null;
    affected_locations: number;
    affected_items: number;
    sample: Array<{ item_name: string; before_path: string; after_path: string }>;
    sample_truncated: boolean;
  };

  assert.equal(impactJson.location_id, garageId);
  assert.equal(impactJson.from_parent_id, houseId);
  assert.equal(impactJson.to_parent_id, null);
  assert.equal(impactJson.affected_locations, 2);
  assert.equal(impactJson.affected_items, 2);
  assert.equal(impactJson.sample_truncated, false);

  const byName = new Map(impactJson.sample.map((entry) => [entry.item_name, entry]));
  assert.equal(byName.get("Compressor")?.before_path, "House > Garage > Compressor");
  assert.equal(byName.get("Compressor")?.after_path, "Garage > Compressor");
  assert.equal(byName.get("Wrench Set")?.before_path, "House > Garage > Shelf > Wrench Set");
  assert.equal(byName.get("Wrench Set")?.after_path, "Garage > Shelf > Wrench Set");

  const garageAfterPreview = await request(`/locations/${garageId}/path`);
  assert.equal(garageAfterPreview.status, 200);
  assert.deepEqual(garageAfterPreview.json, {
    id: garageId,
    name: "Garage",
    path: "House > Garage",
  });
});

test("POST /locations/:id/move-impact rejects cyclical move previews", async () => {
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

  const impact = await request(`/locations/${houseId}/move-impact`, {
    method: "POST",
    body: { parent_id: shelfId },
  });
  assert.equal(impact.status, 400);
  assert.deepEqual(impact.json, { error: "Invalid move: would create a cycle" });
});

test("POST /locations/:id/move-impact handles empty subtree moves", async () => {
  const house = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(house.status, 201);
  const houseId = (house.json as { id: string }).id;

  const emptyRoom = await request("/locations", {
    method: "POST",
    body: { name: "Empty Room", code: "ER1", type: "room", parent_id: houseId },
  });
  assert.equal(emptyRoom.status, 201);
  const emptyRoomId = (emptyRoom.json as { id: string }).id;

  const impact = await request(`/locations/${emptyRoomId}/move-impact`, {
    method: "POST",
    body: { parent_id: null },
  });
  assert.equal(impact.status, 200);

  const impactJson = impact.json as {
    affected_locations: number;
    affected_items: number;
    sample: unknown[];
    sample_truncated: boolean;
  };
  assert.equal(impactJson.affected_locations, 1);
  assert.equal(impactJson.affected_items, 0);
  assert.equal(impactJson.sample.length, 0);
  assert.equal(impactJson.sample_truncated, false);
});

test("Move-impact preview and apply flow supports large subtree updates", async () => {
  const house = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(house.status, 201);
  const houseId = (house.json as { id: string }).id;

  const zoneA = await request("/locations", {
    method: "POST",
    body: { name: "Zone A", code: "ZA1", type: "room", parent_id: houseId },
  });
  assert.equal(zoneA.status, 201);
  const zoneAId = (zoneA.json as { id: string }).id;

  const zoneB = await request("/locations", {
    method: "POST",
    body: { name: "Zone B", code: "ZB1", type: "room", parent_id: houseId },
  });
  assert.equal(zoneB.status, 201);
  const zoneBId = (zoneB.json as { id: string }).id;

  const shelfIds: string[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const shelf = await request("/locations", {
      method: "POST",
      body: {
        name: `Shelf ${index}`,
        code: `S${index}`,
        type: "shelf",
        parent_id: zoneAId,
      },
    });
    assert.equal(shelf.status, 201);
    shelfIds.push((shelf.json as { id: string }).id);
  }

  let itemCounter = 1;
  for (const shelfId of shelfIds) {
    for (let perShelf = 0; perShelf < 3; perShelf += 1) {
      const item = await request("/items", {
        method: "POST",
        body: {
          name: `Bulk Item ${itemCounter}`,
          keywords: ["bulk", "move"],
          location_id: shelfId,
        },
      });
      assert.equal(item.status, 201);
      itemCounter += 1;
    }
  }

  const impact = await request(`/locations/${zoneAId}/move-impact`, {
    method: "POST",
    body: { parent_id: zoneBId },
  });
  assert.equal(impact.status, 200);
  const impactJson = impact.json as {
    affected_locations: number;
    affected_items: number;
    sample: unknown[];
    sample_truncated: boolean;
  };
  assert.equal(impactJson.affected_locations, 6);
  assert.equal(impactJson.affected_items, 15);
  assert.equal(impactJson.sample.length, 10);
  assert.equal(impactJson.sample_truncated, true);

  const appliedMove = await request(`/locations/${zoneAId}`, {
    method: "PATCH",
    body: { parent_id: zoneBId },
  });
  assert.equal(appliedMove.status, 200);

  const movedShelfPath = await request(`/locations/${shelfIds[0]}/path`);
  assert.equal(movedShelfPath.status, 200);
  assert.deepEqual(movedShelfPath.json, {
    id: shelfIds[0],
    name: "Shelf 1",
    path: "House > Zone B > Zone A > Shelf 1",
  });

  const search = await request("/items/search?q=Bulk%20Item%201&limit=1&offset=0");
  assert.equal(search.status, 200);
  const searchJson = search.json as { results: Array<{ location_path: string }>; total: number };
  assert.equal(searchJson.total, 7);
  assert.equal(searchJson.results[0].location_path, "House > Zone B > Zone A > Shelf 1");
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

test("GET /items/search/semantic validates mode", async () => {
  const invalid = await request("/items/search/semantic?q=tool&mode=unsupported");
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.json, { error: "mode must be one of: hybrid, semantic, lexical" });
});

test("GET /items/search/semantic returns ranked results with stable pagination", async () => {
  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: rootId },
  });
  assert.equal(garage.status, 201);
  const garageId = (garage.json as { id: string }).id;

  const drillName = await request("/items", {
    method: "POST",
    body: {
      name: "Drill Alpha",
      keywords: ["power"],
      location_id: garageId,
    },
  });
  assert.equal(drillName.status, 201);

  const drillDescription = await request("/items", {
    method: "POST",
    body: {
      name: "Workshop Tool",
      description: "Drill for concrete anchors",
      keywords: ["tool"],
      location_id: garageId,
    },
  });
  assert.equal(drillDescription.status, 201);

  const drillKeyword = await request("/items", {
    method: "POST",
    body: {
      name: "Bit Organizer",
      keywords: ["drill", "bits"],
      location_id: garageId,
    },
  });
  assert.equal(drillKeyword.status, 201);

  const unrelated = await request("/items", {
    method: "POST",
    body: {
      name: "Storage Bin",
      description: "Plastic tote",
      keywords: ["container"],
      location_id: garageId,
    },
  });
  assert.equal(unrelated.status, 201);

  const page1 = await request("/items/search/semantic?q=drill&limit=2&offset=0");
  assert.equal(page1.status, 200);
  const page1Json = page1.json as {
    results: Array<{
      id: string;
      name: string;
      location_path: string;
      score: number;
      lexical_score: number;
      semantic_score: number;
    }>;
    total: number;
    limit: number;
    offset: number;
    mode: string;
  };

  assert.equal(page1Json.mode, "hybrid");
  assert.equal(page1Json.total, 3);
  assert.equal(page1Json.limit, 2);
  assert.equal(page1Json.offset, 0);
  assert.equal(page1Json.results.length, 2);
  assert.equal(page1Json.results[0].name, "Drill Alpha");
  assert.equal(page1Json.results[1].name, "Workshop Tool");
  assert.match(page1Json.results[0].location_path, /^House > Garage$/);
  assert.ok(page1Json.results[0].score >= page1Json.results[1].score);
  assert.ok(page1Json.results[0].lexical_score >= page1Json.results[1].lexical_score);
  assert.ok(page1Json.results[0].semantic_score > 0);

  const page1Repeat = await request("/items/search/semantic?q=drill&limit=2&offset=0");
  assert.equal(page1Repeat.status, 200);
  const page1RepeatJson = page1Repeat.json as {
    results: Array<{ id: string }>;
  };
  assert.deepEqual(
    page1RepeatJson.results.map((entry) => entry.id),
    page1Json.results.map((entry) => entry.id)
  );

  const page2 = await request("/items/search/semantic?q=drill&limit=2&offset=2");
  assert.equal(page2.status, 200);
  const page2Json = page2.json as {
    results: Array<{ id: string; name: string }>;
    total: number;
    offset: number;
  };

  assert.equal(page2Json.total, 3);
  assert.equal(page2Json.offset, 2);
  assert.equal(page2Json.results.length, 1);
  assert.equal(page2Json.results[0].name, "Bit Organizer");

  const page1Ids = new Set(page1Json.results.map((entry) => entry.id));
  assert.ok(!page1Ids.has(page2Json.results[0].id));
});

test("Semantic relevance regression set remains stable", async () => {
  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const workshop = await request("/locations", {
    method: "POST",
    body: { name: "Workshop", code: "W1", type: "room", parent_id: rootId },
  });
  assert.equal(workshop.status, 201);
  const workshopId = (workshop.json as { id: string }).id;

  const fixtures = [
    {
      name: "Pneumatic Tank Compressor",
      description: "Garage air tool with pressure gauge",
      keywords: ["pneumatic", "tank", "compressor"],
    },
    {
      name: "Portable Tire Inflator",
      description: "Compact inflator for car tires",
      keywords: ["inflator", "air", "tire"],
    },
    {
      name: "Concrete Anchor Drill",
      description: "Hammer drill and masonry anchor kit",
      keywords: ["drill", "concrete", "anchor"],
    },
    {
      name: "Holiday Storage Bin",
      description: "Seasonal decorations organizer",
      keywords: ["storage", "bin", "seasonal"],
    },
  ];

  for (const fixture of fixtures) {
    const created = await request("/items", {
      method: "POST",
      body: {
        name: fixture.name,
        description: fixture.description,
        keywords: fixture.keywords,
        location_id: workshopId,
      },
    });
    assert.equal(created.status, 201);
  }

  const cases = [
    { query: "compressor", mode: "lexical", expectedTop: "Pneumatic Tank Compressor" },
    { query: "pneumatic tank", mode: "semantic", expectedTop: "Pneumatic Tank Compressor" },
    { query: "masonry anchor drill", mode: "hybrid", expectedTop: "Concrete Anchor Drill" },
    { query: "seasonal storage", mode: "hybrid", expectedTop: "Holiday Storage Bin" },
  ];

  for (const testCase of cases) {
    const first = await request(
      `/items/search/semantic?q=${encodeURIComponent(testCase.query)}&mode=${encodeURIComponent(testCase.mode)}&limit=4&offset=0`
    );
    assert.equal(first.status, 200);
    const firstJson = first.json as {
      mode: string;
      results: Array<{ id: string; name: string }>;
    };

    assert.equal(firstJson.mode, testCase.mode);
    assert.ok(firstJson.results.length > 0);
    assert.equal(firstJson.results[0].name, testCase.expectedTop);

    const second = await request(
      `/items/search/semantic?q=${encodeURIComponent(testCase.query)}&mode=${encodeURIComponent(testCase.mode)}&limit=4&offset=0`
    );
    assert.equal(second.status, 200);
    const secondJson = second.json as {
      results: Array<{ id: string }>;
    };

    assert.deepEqual(
      secondJson.results.map((entry) => entry.id),
      firstJson.results.map((entry) => entry.id)
    );
  }
});

test("Semantic mode prunes unrelated tail results for air pump queries", async () => {
  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: rootId },
  });
  assert.equal(garage.status, 201);
  const garageId = (garage.json as { id: string }).id;

  const fixtures = [
    {
      name: "Portable Tire Inflator",
      description: "Compact inflator for car tires",
      keywords: ["inflator", "air", "tire", "pump"],
    },
    {
      name: "Air Compressor",
      description: "Pneumatic compressor for garage tools",
      keywords: ["air", "compressor", "pneumatic"],
    },
    {
      name: "Winter Gloves",
      description: "Insulated gloves for cold weather",
      keywords: ["winter", "gloves"],
    },
    {
      name: "Shovel",
      description: "Driveway snow shovel",
      keywords: ["yard", "snow", "shovel"],
    },
  ];

  for (const fixture of fixtures) {
    const created = await request("/items", {
      method: "POST",
      body: {
        name: fixture.name,
        description: fixture.description,
        keywords: fixture.keywords,
        location_id: garageId,
      },
    });
    assert.equal(created.status, 201);
  }

  const response = await request(
    `/items/search/semantic?q=${encodeURIComponent("air pump")}&mode=semantic&limit=10&offset=0`
  );
  assert.equal(response.status, 200);

  const payload = response.json as {
    mode: string;
    results: Array<{ name: string }>;
  };

  assert.equal(payload.mode, "semantic");
  assert.ok(payload.results.length > 0);

  const names = payload.results.map((entry) => entry.name);
  assert.ok(
    names.includes("Portable Tire Inflator") || names.includes("Air Compressor"),
    "Expected a compressed air tool result for 'air pump'"
  );
  assert.ok(!names.includes("Winter Gloves"));
  assert.ok(!names.includes("Shovel"));
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
    answer: string;
    confidence: number;
    fallback: boolean;
    intent: string;
  };

  assert.equal(payload.item, "Ryobi Air Compressor");
  assert.match(payload.location_path ?? "", /^House > Garage$/);
  assert.equal(typeof payload.notes, "string");
  assert.equal(payload.intent, "find_item");
  assert.equal(typeof payload.answer, "string");
  assert.equal(payload.fallback, false);
  assert.ok(payload.confidence >= 0 && payload.confidence <= 1);
});

test("GET /api/items/lookup supports 'where are my ...' phrasing", async () => {
  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const closet = await request("/locations", {
    method: "POST",
    body: { name: "Hall Closet", code: "C1", type: "closet", parent_id: rootId },
  });
  assert.equal(closet.status, 201);
  const closetId = (closet.json as { id: string }).id;

  const item = await request("/items", {
    method: "POST",
    body: {
      name: "Winter Gloves",
      description: "Black insulated pair",
      keywords: ["gloves", "winter", "snow"],
      location_id: closetId,
    },
  });
  assert.equal(item.status, 201);

  const lookup = await request("/api/items/lookup?q=where%20are%20my%20winter%20gloves");
  assert.equal(lookup.status, 200);

  const payload = lookup.json as {
    intent: string;
    fallback: boolean;
    item: string | null;
    location_path: string | null;
    answer: string;
  };

  assert.equal(payload.intent, "find_item");
  assert.equal(payload.fallback, false);
  assert.equal(payload.item, "Winter Gloves");
  assert.match(payload.location_path ?? "", /^House > Hall Closet$/);
  assert.match(payload.answer, /Winter Gloves is in House > Hall Closet/i);
});

test("GET /api/items/lookup maps list-location intent and returns location summary", async () => {
  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: rootId },
  });
  assert.equal(garage.status, 201);
  const garageId = (garage.json as { id: string }).id;

  const garageShelf = await request("/locations", {
    method: "POST",
    body: { name: "Shelf A", code: "S1", type: "shelf", parent_id: garageId },
  });
  assert.equal(garageShelf.status, 201);
  const garageShelfId = (garageShelf.json as { id: string }).id;

  const directItem = await request("/items", {
    method: "POST",
    body: {
      name: "Shop Vacuum",
      keywords: ["vacuum"],
      location_id: garageId,
    },
  });
  assert.equal(directItem.status, 201);

  const nestedItem = await request("/items", {
    method: "POST",
    body: {
      name: "Nail Gun",
      keywords: ["nailer"],
      location_id: garageShelfId,
    },
  });
  assert.equal(nestedItem.status, 201);

  const lookup = await request("/api/items/lookup?q=what%20is%20in%20the%20garage");
  assert.equal(lookup.status, 200);

  const payload = lookup.json as {
    intent: string;
    fallback: boolean;
    location_path: string | null;
    match_count: number;
    answer: string;
    item: string | null;
  };

  assert.equal(payload.intent, "list_location");
  assert.equal(payload.fallback, false);
  assert.match(payload.location_path ?? "", /^House > Garage$/);
  assert.equal(payload.match_count, 2);
  assert.equal(payload.item, "Nail Gun");
  assert.match(payload.answer, /I found 2 item\(s\) in House > Garage/i);
});

test("GET /api/items/lookup maps count intent and returns count summary", async () => {
  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: rootId },
  });
  assert.equal(garage.status, 201);
  const garageId = (garage.json as { id: string }).id;

  for (const itemName of ["Drill Driver", "Drill Bits", "Cordless Light"]) {
    const created = await request("/items", {
      method: "POST",
      body: {
        name: itemName,
        keywords: itemName.toLowerCase().includes("drill") ? ["drill"] : ["light"],
        location_id: garageId,
      },
    });
    assert.equal(created.status, 201);
  }

  const lookup = await request("/api/items/lookup?q=how%20many%20drill%20do%20i%20have");
  assert.equal(lookup.status, 200);

  const payload = lookup.json as {
    intent: string;
    fallback: boolean;
    match_count: number;
    answer: string;
    item: string | null;
    confidence: number;
  };

  assert.equal(payload.intent, "count_items");
  assert.equal(payload.fallback, false);
  assert.equal(payload.match_count, 2);
  assert.ok(payload.item === "Drill Bits" || payload.item === "Drill Driver");
  assert.match(payload.answer, /I found 2 item\(s\) matching "drill"/i);
  assert.ok(payload.confidence >= 0 && payload.confidence <= 1);
});

test("GET /api/items/lookup handles unsupported action requests safely", async () => {
  const lookup = await request("/api/items/lookup?q=move%20the%20drill%20to%20attic");
  assert.equal(lookup.status, 200);

  const payload = lookup.json as {
    intent: string;
    fallback: boolean;
    answer: string;
    item: string | null;
    location_path: string | null;
    notes: string;
    requires_confirmation: boolean;
  };

  assert.equal(payload.intent, "unsupported_action");
  assert.equal(payload.fallback, true);
  assert.equal(payload.item, null);
  assert.equal(payload.location_path, null);
  assert.equal(payload.requires_confirmation, true);
  assert.match(payload.answer, /can't move or rename inventory from Siri yet/i);
  assert.match(payload.notes, /Unsupported action request/i);
});

test("GET /api/items/lookup supports quantity get/add/remove/set intents", async () => {
  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: rootId },
  });
  assert.equal(garage.status, 201);
  const garageId = (garage.json as { id: string }).id;

  const item = await request("/items", {
    method: "POST",
    body: {
      name: "AA Battery Pack",
      keywords: ["battery", "aa"],
      quantity: 4,
      location_id: garageId,
    },
  });
  assert.equal(item.status, 201);
  const itemId = (item.json as { id: string }).id;

  const getCount = await request("/api/items/lookup?q=get%20count%20of%20aa%20battery%20pack");
  assert.equal(getCount.status, 200);
  const getCountJson = getCount.json as {
    intent: string;
    fallback: boolean;
    quantity: number | null;
    answer: string;
  };
  assert.equal(getCountJson.intent, "get_item_quantity");
  assert.equal(getCountJson.fallback, false);
  assert.equal(getCountJson.quantity, 4);
  assert.match(getCountJson.answer, /has quantity 4/i);

  const addNeedsConfirm = await request("/api/items/lookup?q=add%203%20aa%20battery%20pack");
  assert.equal(addNeedsConfirm.status, 200);
  const addNeedsConfirmJson = addNeedsConfirm.json as {
    intent: string;
    requires_confirmation: boolean;
    quantity: number | null;
    answer: string;
  };
  assert.equal(addNeedsConfirmJson.intent, "add_item_quantity");
  assert.equal(addNeedsConfirmJson.requires_confirmation, true);
  assert.equal(addNeedsConfirmJson.quantity ?? null, null);
  assert.match(addNeedsConfirmJson.answer, /confirmation required/i);

  const addCount = await request(
    "/api/items/lookup?q=add%203%20aa%20battery%20pack&confirm=true&idempotency_key=qty-add-1"
  );
  assert.equal(addCount.status, 200);
  const addCountJson = addCount.json as {
    intent: string;
    quantity: number | null;
    previous_quantity: number | null;
  };
  assert.equal(addCountJson.intent, "add_item_quantity");
  assert.equal(addCountJson.previous_quantity, 4);
  assert.equal(addCountJson.quantity, 7);

  const addCountRepeat = await request(
    "/api/items/lookup?q=add%203%20aa%20battery%20pack&confirm=true&idempotency_key=qty-add-1"
  );
  assert.equal(addCountRepeat.status, 200);
  const addCountRepeatJson = addCountRepeat.json as {
    quantity: number | null;
    previous_quantity: number | null;
  };
  assert.equal(addCountRepeatJson.previous_quantity, 4);
  assert.equal(addCountRepeatJson.quantity, 7);

  const removeCount = await request(
    "/api/items/lookup?q=remove%202%20aa%20battery%20pack&confirm=true&idempotency_key=qty-remove-1"
  );
  assert.equal(removeCount.status, 200);
  const removeCountJson = removeCount.json as {
    intent: string;
    quantity: number | null;
    previous_quantity: number | null;
  };
  assert.equal(removeCountJson.intent, "remove_item_quantity");
  assert.equal(removeCountJson.previous_quantity, 7);
  assert.equal(removeCountJson.quantity, 5);

  const setCount = await request(
    "/api/items/lookup?q=set%20quantity%20of%20aa%20battery%20pack%20to%209&confirm=true&idempotency_key=qty-set-1"
  );
  assert.equal(setCount.status, 200);
  const setCountJson = setCount.json as {
    intent: string;
    quantity: number | null;
    previous_quantity: number | null;
  };
  assert.equal(setCountJson.intent, "set_item_quantity");
  assert.equal(setCountJson.previous_quantity, 5);
  assert.equal(setCountJson.quantity, 9);

  const quantity = await request(`/items/${itemId}/quantity`);
  assert.equal(quantity.status, 200);
  assert.deepEqual(quantity.json, {
    item_id: itemId,
    item_name: "AA Battery Pack",
    quantity: 9,
  });
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

  const movementHistory = await pool.query<{
    item_id: string;
    from_location_id: string;
    to_location_id: string;
    moved_by_user_id: string | null;
    source: string;
    created_at: string | Date;
  }>(
    `
    SELECT item_id, from_location_id, to_location_id, moved_by_user_id, source, created_at
    FROM movement_history
    WHERE item_id = $1
    ORDER BY created_at DESC
    `,
    [itemId]
  );
  assert.equal(movementHistory.rowCount, 1);
  assert.equal(movementHistory.rows[0].item_id, itemId);
  assert.equal(movementHistory.rows[0].from_location_id, garageId);
  assert.equal(movementHistory.rows[0].to_location_id, basementId);
  assert.equal(movementHistory.rows[0].moved_by_user_id, null);
  assert.equal(movementHistory.rows[0].source, "api.items.patch");
  assert.ok(
    typeof movementHistory.rows[0].created_at === "string" ||
      movementHistory.rows[0].created_at instanceof Date
  );

  const deleted = await request(`/items/${itemId}`, { method: "DELETE" });
  assert.equal(deleted.status, 204);

  const afterDelete = await request(`/items/${itemId}`);
  assert.equal(afterDelete.status, 404);
});

test("Item quantity API supports read and set/add/remove operations", async () => {
  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: rootId },
  });
  assert.equal(garage.status, 201);
  const garageId = (garage.json as { id: string }).id;

  const item = await request("/items", {
    method: "POST",
    body: {
      name: "Zip Ties",
      keywords: ["ties", "shop"],
      location_id: garageId,
    },
  });
  assert.equal(item.status, 201);
  const itemId = (item.json as { id: string }).id;

  const initial = await request(`/items/${itemId}/quantity`);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.json, {
    item_id: itemId,
    item_name: "Zip Ties",
    quantity: null,
  });

  const add = await request(`/items/${itemId}/quantity`, {
    method: "PATCH",
    body: { op: "add", amount: 3 },
  });
  assert.equal(add.status, 200);
  assert.deepEqual(add.json, {
    item_id: itemId,
    item_name: "Zip Ties",
    op: "add",
    amount: 3,
    previous_quantity: null,
    quantity: 3,
  });

  const remove = await request(`/items/${itemId}/quantity`, {
    method: "PATCH",
    body: { op: "remove", amount: 2 },
  });
  assert.equal(remove.status, 200);
  assert.deepEqual(remove.json, {
    item_id: itemId,
    item_name: "Zip Ties",
    op: "remove",
    amount: 2,
    previous_quantity: 3,
    quantity: 1,
  });

  const set = await request(`/items/${itemId}/quantity`, {
    method: "PATCH",
    body: { op: "set", quantity: 10 },
  });
  assert.equal(set.status, 200);
  assert.deepEqual(set.json, {
    item_id: itemId,
    item_name: "Zip Ties",
    op: "set",
    amount: null,
    previous_quantity: 1,
    quantity: 10,
  });

  const removeTooMuch = await request(`/items/${itemId}/quantity`, {
    method: "PATCH",
    body: { op: "remove", amount: 11 },
  });
  assert.equal(removeTooMuch.status, 409);
  assert.deepEqual(removeTooMuch.json, {
    error: "Cannot remove 11; current quantity is 10",
  });

  const clear = await request(`/items/${itemId}`, {
    method: "PATCH",
    body: { quantity: null },
  });
  assert.equal(clear.status, 200);
  const clearJson = clear.json as { quantity: number | null };
  assert.equal(clearJson.quantity, null);
});

test("GET /items/:id/history returns chronological events with optional date filtering", async () => {
  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: rootId },
  });
  assert.equal(garage.status, 201);
  const garageId = (garage.json as { id: string }).id;

  const attic = await request("/locations", {
    method: "POST",
    body: { name: "Attic", code: "A1", type: "room", parent_id: rootId },
  });
  assert.equal(attic.status, 201);
  const atticId = (attic.json as { id: string }).id;

  const basement = await request("/locations", {
    method: "POST",
    body: { name: "Basement", code: "B1", type: "room", parent_id: rootId },
  });
  assert.equal(basement.status, 201);
  const basementId = (basement.json as { id: string }).id;

  const item = await request("/items", {
    method: "POST",
    body: {
      name: "Sledge Hammer",
      keywords: ["tool", "hammer"],
      location_id: garageId,
    },
  });
  assert.equal(item.status, 201);
  const itemId = (item.json as { id: string }).id;

  const moveToAttic = await request(`/items/${itemId}`, {
    method: "PATCH",
    body: { location_id: atticId },
  });
  assert.equal(moveToAttic.status, 200);

  const moveToBasement = await request(`/items/${itemId}`, {
    method: "PATCH",
    body: { location_id: basementId },
  });
  assert.equal(moveToBasement.status, 200);

  await pool.query(
    `
    UPDATE movement_history
    SET created_at = $2::timestamptz
    WHERE item_id = $1 AND from_location_id = $3 AND to_location_id = $4
    `,
    [itemId, "2026-01-01T00:00:00.000Z", garageId, atticId]
  );
  await pool.query(
    `
    UPDATE movement_history
    SET created_at = $2::timestamptz
    WHERE item_id = $1 AND from_location_id = $3 AND to_location_id = $4
    `,
    [itemId, "2026-01-02T00:00:00.000Z", atticId, basementId]
  );

  const history = await request(`/items/${itemId}/history?limit=10&offset=0`);
  assert.equal(history.status, 200);

  const historyJson = history.json as {
    item_id: string;
    total: number;
    limit: number;
    offset: number;
    order: string;
    from: string | null;
    to: string | null;
    events: Array<{
      from_location_id: string;
      to_location_id: string;
      from_location_path: string | null;
      to_location_path: string | null;
      source: string;
      created_at: string;
    }>;
  };

  assert.equal(historyJson.item_id, itemId);
  assert.equal(historyJson.total, 2);
  assert.equal(historyJson.limit, 10);
  assert.equal(historyJson.offset, 0);
  assert.equal(historyJson.order, "desc");
  assert.equal(historyJson.from, null);
  assert.equal(historyJson.to, null);
  assert.equal(historyJson.events.length, 2);
  assert.equal(historyJson.events[0].from_location_id, atticId);
  assert.equal(historyJson.events[0].to_location_id, basementId);
  assert.match(historyJson.events[0].from_location_path ?? "", /^House > Attic$/);
  assert.match(historyJson.events[0].to_location_path ?? "", /^House > Basement$/);
  assert.equal(historyJson.events[0].source, "api.items.patch");
  assert.equal(historyJson.events[1].from_location_id, garageId);
  assert.equal(historyJson.events[1].to_location_id, atticId);
  assert.match(historyJson.events[1].from_location_path ?? "", /^House > Garage$/);
  assert.match(historyJson.events[1].to_location_path ?? "", /^House > Attic$/);
  assert.ok(historyJson.events[0].created_at >= historyJson.events[1].created_at);

  const filtered = await request(
    `/items/${itemId}/history?from=${encodeURIComponent("2026-01-02T00:00:00.000Z")}&limit=10&offset=0`
  );
  assert.equal(filtered.status, 200);
  const filteredJson = filtered.json as {
    total: number;
    from: string | null;
    events: Array<{ to_location_id: string }>;
  };
  assert.equal(filteredJson.total, 1);
  assert.equal(filteredJson.events.length, 1);
  assert.equal(filteredJson.events[0].to_location_id, basementId);
  assert.equal(filteredJson.from, "2026-01-02T00:00:00.000Z");

  const invalidRange = await request(
    `/items/${itemId}/history?from=${encodeURIComponent("2026-01-03T00:00:00.000Z")}&to=${encodeURIComponent("2026-01-01T00:00:00.000Z")}`
  );
  assert.equal(invalidRange.status, 400);
  assert.deepEqual(invalidRange.json, { error: "from must be less than or equal to to" });
});

test("GET /items/:id/history enforces inventory scope", async () => {
  const owner = await request("/auth/register", {
    method: "POST",
    body: { email: "history-owner@example.com", password: "SuperSecret123!" },
  });
  assert.equal(owner.status, 201);
  const ownerToken = (owner.json as { token: string }).token;

  const outsider = await request("/auth/register", {
    method: "POST",
    body: { email: "history-outsider@example.com", password: "SuperSecret123!" },
  });
  assert.equal(outsider.status, 201);
  const outsiderToken = (outsider.json as { token: string }).token;

  const root = await request("/locations", {
    method: "POST",
    token: ownerToken,
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    token: ownerToken,
    body: { name: "Garage", code: "G1", type: "room", parent_id: rootId },
  });
  assert.equal(garage.status, 201);
  const garageId = (garage.json as { id: string }).id;

  const shed = await request("/locations", {
    method: "POST",
    token: ownerToken,
    body: { name: "Shed", code: "S1", type: "room", parent_id: rootId },
  });
  assert.equal(shed.status, 201);
  const shedId = (shed.json as { id: string }).id;

  const item = await request("/items", {
    method: "POST",
    token: ownerToken,
    body: {
      name: "Leaf Blower",
      keywords: ["yard"],
      location_id: garageId,
    },
  });
  assert.equal(item.status, 201);
  const itemId = (item.json as { id: string }).id;

  const moved = await request(`/items/${itemId}`, {
    method: "PATCH",
    token: ownerToken,
    body: { location_id: shedId },
  });
  assert.equal(moved.status, 200);

  const ownerHistory = await request(`/items/${itemId}/history`, {
    token: ownerToken,
  });
  assert.equal(ownerHistory.status, 200);
  const ownerHistoryJson = ownerHistory.json as { total: number };
  assert.equal(ownerHistoryJson.total, 1);

  const outsiderHistory = await request(`/items/${itemId}/history`, {
    token: outsiderToken,
  });
  assert.equal(outsiderHistory.status, 404);
  assert.deepEqual(outsiderHistory.json, { error: "Item not found" });
});

test("Embeddings reindex supports chunked resume and full reindex", async () => {
  const { reindexItemEmbeddings } = await import("../search/reindexItemEmbeddings");

  const root = await request("/locations", {
    method: "POST",
    body: { name: "House", code: "H1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    body: { name: "Garage", code: "G1", type: "room", parent_id: rootId },
  });
  assert.equal(garage.status, 201);
  const garageId = (garage.json as { id: string }).id;

  await pool.query(
    `
    INSERT INTO items(name, description, keywords, location_id, image_url)
    VALUES
      ($1, $2, $3::text[], $4, $5),
      ($6, $7, $8::text[], $9, $10),
      ($11, $12, $13::text[], $14, $15)
    `,
    [
      "Cordless Drill",
      "18v drill",
      ["tool", "drill"],
      garageId,
      null,
      "Circular Saw",
      "Compact saw",
      ["tool", "saw"],
      garageId,
      null,
      "Ratchet Set",
      "Mechanic ratchet",
      ["tool", "ratchet"],
      garageId,
      null,
    ]
  );

  const firstPass = await reindexItemEmbeddings({
    mode: "missing",
    batchSize: 2,
    maxBatches: 1,
  });
  assert.equal(firstPass.completed, false);
  assert.equal(firstPass.batches, 1);
  assert.equal(firstPass.totalProcessed, 2);
  assert.ok(firstPass.lastItemId);

  const resumePass = await reindexItemEmbeddings({
    mode: "missing",
    batchSize: 2,
    afterId: firstPass.lastItemId,
  });
  assert.equal(resumePass.completed, true);
  assert.equal(resumePass.totalProcessed, 1);

  const fullReindex = await reindexItemEmbeddings({
    mode: "all",
    batchSize: 2,
  });
  assert.equal(fullReindex.completed, true);
  assert.equal(fullReindex.totalProcessed, 3);
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

test("Household members can collaborate within shared household scope", async () => {
  const owner = await request("/auth/register", {
    method: "POST",
    body: { email: "collab-owner@example.com", password: "SuperSecret123!" },
  });
  assert.equal(owner.status, 201);
  const ownerToken = (owner.json as { token: string }).token;

  const editor = await request("/auth/register", {
    method: "POST",
    body: { email: "collab-editor@example.com", password: "SuperSecret123!" },
  });
  assert.equal(editor.status, 201);
  const editorJson = editor.json as { token: string; user: { id: string } };
  const editorToken = editorJson.token;
  const editorUserId = editorJson.user.id;

  const ownerHouseholds = await request("/households", { token: ownerToken });
  assert.equal(ownerHouseholds.status, 200);
  const sharedHouseholdId = (ownerHouseholds.json as { households: Array<{ id: string }> })
    .households[0].id;
  const sharedHeader = { "x-household-id": sharedHouseholdId };

  const invite = await request(`/households/${sharedHouseholdId}/invitations`, {
    method: "POST",
    token: ownerToken,
    body: { email: "collab-editor@example.com", role: "editor" },
  });
  assert.equal(invite.status, 201);
  const invitationToken = (invite.json as { invitation_token: string }).invitation_token;

  const accept = await request("/households/invitations/accept", {
    method: "POST",
    token: editorToken,
    body: { token: invitationToken },
  });
  assert.equal(accept.status, 200);

  const root = await request("/locations", {
    method: "POST",
    token: ownerToken,
    headers: sharedHeader,
    body: { name: "Shared House", code: "SH1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const garage = await request("/locations", {
    method: "POST",
    token: ownerToken,
    headers: sharedHeader,
    body: { name: "Shared Garage", code: "SH1-G1", type: "room", parent_id: rootId },
  });
  assert.equal(garage.status, 201);
  const garageId = (garage.json as { id: string }).id;

  const createdItem = await request("/items", {
    method: "POST",
    token: ownerToken,
    headers: sharedHeader,
    body: {
      name: "Shared Ladder",
      keywords: ["shared", "ladder"],
      location_id: rootId,
    },
  });
  assert.equal(createdItem.status, 201);
  const itemId = (createdItem.json as { id: string }).id;

  const editorCannotSeeWithoutScope = await request(`/items/${itemId}`, { token: editorToken });
  assert.equal(editorCannotSeeWithoutScope.status, 404);

  const editorReadsShared = await request(`/items/${itemId}`, {
    token: editorToken,
    headers: sharedHeader,
  });
  assert.equal(editorReadsShared.status, 200);

  const editorUpdatesShared = await request(`/items/${itemId}`, {
    method: "PATCH",
    token: editorToken,
    headers: sharedHeader,
    body: { name: "Shared Ladder v2" },
  });
  assert.equal(editorUpdatesShared.status, 200);
  assert.equal((editorUpdatesShared.json as { name: string }).name, "Shared Ladder v2");

  const editorMovesShared = await request(`/items/${itemId}`, {
    method: "PATCH",
    token: editorToken,
    headers: sharedHeader,
    body: { location_id: garageId },
  });
  assert.equal(editorMovesShared.status, 200);
  assert.equal((editorMovesShared.json as { location_id: string }).location_id, garageId);

  const movementHistory = await pool.query<{
    from_location_id: string;
    to_location_id: string;
    moved_by_user_id: string | null;
    household_id: string | null;
  }>(
    `
    SELECT from_location_id, to_location_id, moved_by_user_id, household_id
    FROM movement_history
    WHERE item_id = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [itemId]
  );
  assert.equal(movementHistory.rowCount, 1);
  assert.equal(movementHistory.rows[0].from_location_id, rootId);
  assert.equal(movementHistory.rows[0].to_location_id, garageId);
  assert.equal(movementHistory.rows[0].moved_by_user_id, editorUserId);
  assert.equal(movementHistory.rows[0].household_id, sharedHouseholdId);

  const editorCreatesShared = await request("/items", {
    method: "POST",
    token: editorToken,
    headers: sharedHeader,
    body: {
      name: "Shared Drill",
      keywords: ["shared", "drill"],
      location_id: rootId,
    },
  });
  assert.equal(editorCreatesShared.status, 201);
});

test("Viewer role remains read-only in shared household scope", async () => {
  const owner = await request("/auth/register", {
    method: "POST",
    body: { email: "viewer-owner@example.com", password: "SuperSecret123!" },
  });
  assert.equal(owner.status, 201);
  const ownerToken = (owner.json as { token: string }).token;

  const viewer = await request("/auth/register", {
    method: "POST",
    body: { email: "viewer-user@example.com", password: "SuperSecret123!" },
  });
  assert.equal(viewer.status, 201);
  const viewerToken = (viewer.json as { token: string }).token;

  const ownerHouseholds = await request("/households", { token: ownerToken });
  assert.equal(ownerHouseholds.status, 200);
  const sharedHouseholdId = (ownerHouseholds.json as { households: Array<{ id: string }> })
    .households[0].id;
  const sharedHeader = { "x-household-id": sharedHouseholdId };

  const invite = await request(`/households/${sharedHouseholdId}/invitations`, {
    method: "POST",
    token: ownerToken,
    body: { email: "viewer-user@example.com", role: "viewer" },
  });
  assert.equal(invite.status, 201);
  const invitationToken = (invite.json as { invitation_token: string }).invitation_token;

  const accept = await request("/households/invitations/accept", {
    method: "POST",
    token: viewerToken,
    body: { token: invitationToken },
  });
  assert.equal(accept.status, 200);

  const root = await request("/locations", {
    method: "POST",
    token: ownerToken,
    headers: sharedHeader,
    body: { name: "Viewer House", code: "VH1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const createdItem = await request("/items", {
    method: "POST",
    token: ownerToken,
    headers: sharedHeader,
    body: {
      name: "Viewer Shared Item",
      keywords: ["shared"],
      location_id: rootId,
    },
  });
  assert.equal(createdItem.status, 201);
  const itemId = (createdItem.json as { id: string }).id;

  const viewerTree = await request("/inventory/tree", {
    token: viewerToken,
    headers: sharedHeader,
  });
  assert.equal(viewerTree.status, 200);
  const viewerTreeJson = viewerTree.json as { total_items: number; total_locations: number };
  assert.equal(viewerTreeJson.total_locations, 1);
  assert.equal(viewerTreeJson.total_items, 1);

  const viewerCannotCreate = await request("/items", {
    method: "POST",
    token: viewerToken,
    headers: sharedHeader,
    body: {
      name: "Blocked Create",
      keywords: ["blocked"],
      location_id: rootId,
    },
  });
  assert.equal(viewerCannotCreate.status, 403);

  const viewerCannotPatch = await request(`/items/${itemId}`, {
    method: "PATCH",
    token: viewerToken,
    headers: sharedHeader,
    body: { name: "Blocked Patch" },
  });
  assert.equal(viewerCannotPatch.status, 403);

  const viewerCannotDelete = await request(`/items/${itemId}`, {
    method: "DELETE",
    token: viewerToken,
    headers: sharedHeader,
  });
  assert.equal(viewerCannotDelete.status, 403);
});

test("Cross-household access is denied when selecting another household id", async () => {
  const owner = await request("/auth/register", {
    method: "POST",
    body: { email: "cross-owner@example.com", password: "SuperSecret123!" },
  });
  assert.equal(owner.status, 201);
  const ownerToken = (owner.json as { token: string }).token;

  const outsider = await request("/auth/register", {
    method: "POST",
    body: { email: "cross-outsider@example.com", password: "SuperSecret123!" },
  });
  assert.equal(outsider.status, 201);
  const outsiderToken = (outsider.json as { token: string }).token;

  const ownerHouseholds = await request("/households", { token: ownerToken });
  assert.equal(ownerHouseholds.status, 200);
  const ownerHouseholdId = (ownerHouseholds.json as { households: Array<{ id: string }> })
    .households[0].id;
  const ownerHeader = { "x-household-id": ownerHouseholdId };

  const root = await request("/locations", {
    method: "POST",
    token: ownerToken,
    headers: ownerHeader,
    body: { name: "Cross House", code: "CH1", type: "house", parent_id: null },
  });
  assert.equal(root.status, 201);
  const rootId = (root.json as { id: string }).id;

  const createdItem = await request("/items", {
    method: "POST",
    token: ownerToken,
    headers: ownerHeader,
    body: {
      name: "Cross Item",
      keywords: ["private"],
      location_id: rootId,
    },
  });
  assert.equal(createdItem.status, 201);
  const itemId = (createdItem.json as { id: string }).id;

  const outsiderCannotSelectHousehold = await request(`/items/${itemId}`, {
    token: outsiderToken,
    headers: { "x-household-id": ownerHouseholdId },
  });
  assert.equal(outsiderCannotSelectHousehold.status, 404);
  assert.deepEqual(outsiderCannotSelectHousehold.json, { error: "Household not found" });

  const outsiderCannotWriteHousehold = await request("/items", {
    method: "POST",
    token: outsiderToken,
    headers: { "x-household-id": ownerHouseholdId },
    body: {
      name: "Cross Write",
      keywords: ["blocked"],
      location_id: rootId,
    },
  });
  assert.equal(outsiderCannotWriteHousehold.status, 404);
  assert.deepEqual(outsiderCannotWriteHousehold.json, { error: "Household not found" });
});

test("Household owners can list invites, update roles, and remove members", async () => {
  const owner = await request("/auth/register", {
    method: "POST",
    body: { email: "manage-owner@example.com", password: "SuperSecret123!" },
  });
  assert.equal(owner.status, 201);
  const ownerJson = owner.json as { token: string; user: { id: string } };
  const ownerToken = ownerJson.token;
  const ownerUserId = ownerJson.user.id;

  const member = await request("/auth/register", {
    method: "POST",
    body: { email: "manage-member@example.com", password: "SuperSecret123!" },
  });
  assert.equal(member.status, 201);
  const memberJson = member.json as { token: string; user: { id: string } };
  const memberToken = memberJson.token;
  const memberUserId = memberJson.user.id;

  const ownerHouseholds = await request("/households", { token: ownerToken });
  assert.equal(ownerHouseholds.status, 200);
  const householdId = (ownerHouseholds.json as { households: Array<{ id: string }> }).households[0]
    .id;
  const sharedHeader = { "x-household-id": householdId };

  const memberInvite = await request(`/households/${householdId}/invitations`, {
    method: "POST",
    token: ownerToken,
    body: { email: "manage-member@example.com", role: "viewer" },
  });
  assert.equal(memberInvite.status, 201);
  const memberInviteToken = (memberInvite.json as { invitation_token: string }).invitation_token;

  const pendingInvite = await request(`/households/${householdId}/invitations`, {
    method: "POST",
    token: ownerToken,
    body: { email: "pending-only@example.com", role: "viewer" },
  });
  assert.equal(pendingInvite.status, 201);

  const ownerInvites = await request(`/households/${householdId}/invitations`, {
    token: ownerToken,
  });
  assert.equal(ownerInvites.status, 200);
  const ownerInvitesJson = ownerInvites.json as { invitations: Array<{ email: string }> };
  assert.ok(
    ownerInvitesJson.invitations.some((invite) => invite.email === "manage-member@example.com")
  );
  assert.ok(
    ownerInvitesJson.invitations.some((invite) => invite.email === "pending-only@example.com")
  );

  const accepted = await request("/households/invitations/accept", {
    method: "POST",
    token: memberToken,
    body: { token: memberInviteToken },
  });
  assert.equal(accepted.status, 200);

  const memberCannotListInvites = await request(`/households/${householdId}/invitations`, {
    token: memberToken,
  });
  assert.equal(memberCannotListInvites.status, 403);

  const promoteMember = await request(`/households/${householdId}/members/${memberUserId}`, {
    method: "PATCH",
    token: ownerToken,
    body: { role: "editor" },
  });
  assert.equal(promoteMember.status, 200);
  assert.deepEqual(promoteMember.json, {
    household_id: householdId,
    member_user_id: memberUserId,
    role: "editor",
  });

  const editorCanCreate = await request("/locations", {
    method: "POST",
    token: memberToken,
    headers: sharedHeader,
    body: { name: "Editor Can Create", code: "ED1", type: "room", parent_id: null },
  });
  assert.equal(editorCanCreate.status, 201);

  const demoteMember = await request(`/households/${householdId}/members/${memberUserId}`, {
    method: "PATCH",
    token: ownerToken,
    body: { role: "viewer" },
  });
  assert.equal(demoteMember.status, 200);

  const viewerCannotCreate = await request("/locations", {
    method: "POST",
    token: memberToken,
    headers: sharedHeader,
    body: { name: "Viewer Blocked", code: "VW1", type: "room", parent_id: null },
  });
  assert.equal(viewerCannotCreate.status, 403);

  const removeMember = await request(`/households/${householdId}/members/${memberUserId}`, {
    method: "DELETE",
    token: ownerToken,
  });
  assert.equal(removeMember.status, 200);
  assert.deepEqual(removeMember.json, { removed: true, member_user_id: memberUserId });

  const removedMemberCannotAccess = await request("/inventory/tree", {
    token: memberToken,
    headers: sharedHeader,
  });
  assert.equal(removedMemberCannotAccess.status, 404);
  assert.deepEqual(removedMemberCannotAccess.json, { error: "Household not found" });

  const cannotRemoveLastOwner = await request(`/households/${householdId}/members/${ownerUserId}`, {
    method: "DELETE",
    token: ownerToken,
  });
  assert.equal(cannotRemoveLastOwner.status, 409);
});
