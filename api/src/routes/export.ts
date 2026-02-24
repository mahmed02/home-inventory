import { Request, Response, Router } from "express";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { pool } from "../db/pool";
import {
  InventoryScope,
  canWriteInventory,
  inventoryScopeSql,
  resolveInventoryScope,
} from "../auth/inventoryScope";
import { createInMemoryRateLimit } from "../middleware/rateLimit";
import { sendConflict, sendInternalError, sendValidationError } from "../middleware/http";
import { invalidateSemanticSearchCacheForScope } from "../search/semanticSearch";
import { ItemRow, LocationRow } from "../types";
import { isUuid } from "../utils";

type ImportPayload = {
  locations?: LocationRow[];
  items?: ItemRow[];
};

const exportRouter = Router();
exportRouter.use(
  createInMemoryRateLimit({
    keyPrefix: "export-import",
    max: 200,
    windowMs: 60_000,
  })
);

async function resolveScope(req: Request, res: Response): Promise<InventoryScope | null> {
  const scopeResult = await resolveInventoryScope(req);
  if (!scopeResult.ok) {
    res.status(scopeResult.status).json({ error: scopeResult.message });
    return null;
  }
  return scopeResult.scope;
}

function ensureWriteAccess(scope: InventoryScope, res: Response): boolean {
  if (!canWriteInventory(scope)) {
    res.status(403).json({ error: "Household role does not allow write access" });
    return false;
  }
  return true;
}

function parseBooleanQuery(value: unknown): boolean {
  return typeof value === "string" && value.toLowerCase() === "true";
}

function validTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function validateLocationRow(row: LocationRow): string | null {
  if (!row.id || !isUuid(row.id)) {
    return "locations[].id must be a UUID";
  }
  if (!row.name || row.name.trim().length === 0) {
    return "locations[].name is required";
  }
  if (row.parent_id && !isUuid(row.parent_id)) {
    return "locations[].parent_id must be a UUID or null";
  }
  if (!validTimestamp(row.created_at) || !validTimestamp(row.updated_at)) {
    return "locations[] timestamps must be valid ISO datetime strings";
  }
  return null;
}

function validateItemRow(row: ItemRow): string | null {
  if (!row.id || !isUuid(row.id)) {
    return "items[].id must be a UUID";
  }
  if (!row.name || row.name.trim().length === 0) {
    return "items[].name is required";
  }
  if (!row.location_id || !isUuid(row.location_id)) {
    return "items[].location_id must be a UUID";
  }
  if (!Array.isArray(row.keywords)) {
    return "items[].keywords must be an array of strings";
  }
  if (typeof row.quantity !== "undefined" && row.quantity !== null) {
    if (!Number.isInteger(row.quantity) || row.quantity < 0) {
      return "items[].quantity must be a non-negative integer or null";
    }
  }
  if (!validTimestamp(row.created_at) || !validTimestamp(row.updated_at)) {
    return "items[] timestamps must be valid ISO datetime strings";
  }
  return null;
}

function topoSortLocations(rows: LocationRow[]): LocationRow[] | null {
  const pending = new Map(rows.map((row) => [row.id, row]));
  const sorted: LocationRow[] = [];

  while (pending.size > 0) {
    let progressed = false;

    for (const [id, row] of pending) {
      if (!row.parent_id || !pending.has(row.parent_id)) {
        sorted.push(row);
        pending.delete(id);
        progressed = true;
      }
    }

    if (!progressed) {
      return null;
    }
  }

  return sorted;
}

async function insertImportData(
  client: PoolClient,
  locations: LocationRow[],
  items: ItemRow[],
  scope: InventoryScope
): Promise<void> {
  const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 1);
  const locationScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 1);
  await client.query(`DELETE FROM items WHERE ${itemScope.sql}`, [...itemScope.params]);
  await client.query(`DELETE FROM locations WHERE ${locationScope.sql}`, [...locationScope.params]);

  for (const row of locations) {
    await client.query(
      `
      INSERT INTO locations(
        id, name, code, type, parent_id, description, image_url, created_at, updated_at, owner_user_id, household_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        row.id,
        row.name,
        row.code,
        row.type,
        row.parent_id,
        row.description,
        row.image_url,
        row.created_at,
        row.updated_at,
        scope.ownerUserId,
        scope.householdId,
      ]
    );
  }

  for (const row of items) {
    await client.query(
      `
      INSERT INTO items(
        id, name, description, keywords, quantity, location_id, image_url, created_at, updated_at, owner_user_id, household_id
      )
      VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        row.id,
        row.name,
        row.description,
        row.keywords,
        row.quantity ?? null,
        row.location_id,
        row.image_url,
        row.created_at,
        row.updated_at,
        scope.ownerUserId,
        scope.householdId,
      ]
    );
  }
}

async function mergeImportData(
  client: PoolClient,
  locations: LocationRow[],
  items: ItemRow[],
  scope: InventoryScope
): Promise<void> {
  for (const row of locations) {
    await client.query(
      `
      INSERT INTO locations(
        id, name, code, type, parent_id, description, image_url, created_at, updated_at, owner_user_id, household_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        row.id,
        row.name,
        row.code,
        row.type,
        row.parent_id,
        row.description,
        row.image_url,
        row.created_at,
        row.updated_at,
        scope.ownerUserId,
        scope.householdId,
      ]
    );
  }

  for (const row of items) {
    await client.query(
      `
      INSERT INTO items(
        id, name, description, keywords, quantity, location_id, image_url, created_at, updated_at, owner_user_id, household_id
      )
      VALUES ($1,$2,$3,$4::text[],$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        row.id,
        row.name,
        row.description,
        row.keywords,
        row.quantity ?? null,
        row.location_id,
        row.image_url,
        row.created_at,
        row.updated_at,
        scope.ownerUserId,
        scope.householdId,
      ]
    );
  }
}

function buildUniqueCode(baseCode: string, seenCodes: Set<string>): string {
  const trimmed = baseCode.trim();
  if (!seenCodes.has(trimmed)) {
    seenCodes.add(trimmed);
    return trimmed;
  }

  let attempt = 2;
  while (attempt < 10_000) {
    const candidate = `${trimmed}-import-${attempt}`;
    if (!seenCodes.has(candidate)) {
      seenCodes.add(candidate);
      return candidate;
    }
    attempt += 1;
  }

  const fallback = `${trimmed}-${randomUUID().slice(0, 8)}`;
  seenCodes.add(fallback);
  return fallback;
}

async function remapImportPayload(
  client: PoolClient,
  locations: LocationRow[],
  items: ItemRow[],
  scope: InventoryScope
): Promise<{ locations: LocationRow[]; items: ItemRow[] }> {
  const scopeClause = inventoryScopeSql(scope, "household_id", "owner_user_id", 1);
  const existingCodesResult = await client.query<{ code: string }>(
    `
    SELECT code
    FROM locations
    WHERE code IS NOT NULL AND ${scopeClause.sql}
    `,
    [...scopeClause.params]
  );
  const seenCodes = new Set(existingCodesResult.rows.map((row) => row.code));

  const locationIdMap = new Map<string, string>();
  for (const row of locations) {
    locationIdMap.set(row.id, randomUUID());
  }

  const itemIdMap = new Map<string, string>();
  for (const row of items) {
    itemIdMap.set(row.id, randomUUID());
  }

  const remappedLocations = locations.map((row) => ({
    ...row,
    id: locationIdMap.get(row.id) ?? row.id,
    parent_id: row.parent_id ? (locationIdMap.get(row.parent_id) ?? row.parent_id) : null,
    code: row.code ? buildUniqueCode(row.code, seenCodes) : null,
  }));

  const remappedItems = items.map((row) => ({
    ...row,
    id: itemIdMap.get(row.id) ?? row.id,
    location_id: locationIdMap.get(row.location_id) ?? row.location_id,
  }));

  return { locations: remappedLocations, items: remappedItems };
}

exportRouter.get("/export/inventory", async (req, res) => {
  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }

    const locationScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 1);
    const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 1);
    const [locationsResult, itemsResult] = await Promise.all([
      pool.query<LocationRow>(
        `SELECT * FROM locations WHERE ${locationScope.sql} ORDER BY created_at ASC`,
        [...locationScope.params]
      ),
      pool.query<ItemRow>(`SELECT * FROM items WHERE ${itemScope.sql} ORDER BY created_at ASC`, [
        ...itemScope.params,
      ]),
    ]);

    return res.status(200).json({
      exported_at: new Date().toISOString(),
      version: 1,
      counts: {
        locations: locationsResult.rows.length,
        items: itemsResult.rows.length,
      },
      locations: locationsResult.rows,
      items: itemsResult.rows,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

exportRouter.post("/import/inventory", async (req, res) => {
  const validateOnly = parseBooleanQuery(req.query.validate_only);
  const remapIds = parseBooleanQuery(req.query.remap_ids);
  const body = req.body as ImportPayload;
  const locations = Array.isArray(body.locations) ? body.locations : null;
  const items = Array.isArray(body.items) ? body.items : null;

  if (!locations || !items) {
    return sendValidationError(res, "locations and items arrays are required");
  }

  const scope = await resolveScope(req, res);
  if (!scope) {
    return;
  }
  if (!validateOnly && !ensureWriteAccess(scope, res)) {
    return;
  }

  for (const row of locations) {
    const error = validateLocationRow(row);
    if (error) {
      return sendValidationError(res, error);
    }
  }

  for (const row of items) {
    const error = validateItemRow(row);
    if (error) {
      return sendValidationError(res, error);
    }
  }

  const locationIds = new Set(locations.map((row) => row.id));
  const itemIds = new Set(items.map((row) => row.id));

  if (locationIds.size !== locations.length) {
    return sendConflict(res, "Duplicate location ids in import payload");
  }

  if (itemIds.size !== items.length) {
    return sendConflict(res, "Duplicate item ids in import payload");
  }

  if (!remapIds) {
    const nonNullCodes = locations
      .map((row) => row.code)
      .filter((code): code is string => Boolean(code));
    if (new Set(nonNullCodes).size !== nonNullCodes.length) {
      return sendConflict(res, "Duplicate non-null location codes in import payload");
    }
  }

  for (const row of locations) {
    if (row.parent_id && !locationIds.has(row.parent_id)) {
      return sendValidationError(
        res,
        `Location parent_id ${row.parent_id} does not exist in payload`
      );
    }
  }

  for (const row of items) {
    if (!locationIds.has(row.location_id)) {
      return sendValidationError(
        res,
        `Item location_id ${row.location_id} does not exist in payload`
      );
    }
  }

  const sortedLocations = topoSortLocations(locations);
  if (!sortedLocations) {
    return sendValidationError(
      res,
      "Location hierarchy contains a cycle or invalid parent references"
    );
  }

  if (validateOnly) {
    return res.status(200).json({
      valid: true,
      mode: remapIds ? "validate-remap" : "validate-replace",
      counts: {
        locations: locations.length,
        items: items.length,
      },
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (remapIds) {
      const remapped = await remapImportPayload(client, sortedLocations, items, scope);
      await mergeImportData(client, remapped.locations, remapped.items, scope);
    } else {
      await insertImportData(client, sortedLocations, items, scope);
    }
    await client.query("COMMIT");
    await invalidateSemanticSearchCacheForScope(scope);

    return res.status(200).json({
      imported: true,
      mode: remapIds ? "merge-remap" : "replace",
      counts: {
        locations: locations.length,
        items: items.length,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return sendInternalError(error, res);
  } finally {
    client.release();
  }
});

export default exportRouter;
