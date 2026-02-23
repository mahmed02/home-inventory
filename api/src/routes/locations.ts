import { Request, Response, Router } from "express";
import {
  getDbErrorCode,
  sendConflict,
  sendInternalError,
  sendNotFound,
  sendValidationError,
} from "../middleware/http";
import { asOptionalText, asOptionalUuid, asRequiredText } from "../middleware/validation";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { ensureLocationQrCode } from "../db/locationQRCodes";
import {
  InventoryScope,
  canWriteInventory,
  inventoryScopeSql,
  resolveInventoryScope,
} from "../auth/inventoryScope";
import { LocationRow } from "../types";
import { isUuid, normalizeOptionalText } from "../utils";

const locationsRouter = Router();

type TreeNode = LocationRow & { children: TreeNode[] };
type LocationPathNode = { id: string; name: string; parent_id: string | null };

async function resolveScope(req: Request, res: Response) {
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

function collectDescendantIds(
  rootLocationId: string,
  childrenByParent: Map<string | null, string[]>
): string[] {
  const visited = new Set<string>();
  const stack = [rootLocationId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const children = childrenByParent.get(current) || [];
    for (const childId of children) {
      if (!visited.has(childId)) {
        stack.push(childId);
      }
    }
  }

  return [...visited];
}

function renderLocationPath(
  locationId: string,
  locationMapById: Map<string, LocationPathNode>,
  movedLocationId: string | null,
  movedNewParentId: string | null
): string {
  const names: string[] = [];
  let cursor: string | null = locationId;
  const visited = new Set<string>();

  while (cursor) {
    if (visited.has(cursor)) {
      break;
    }
    visited.add(cursor);

    const node = locationMapById.get(cursor);
    if (!node) {
      break;
    }
    names.push(node.name);

    if (movedLocationId && cursor === movedLocationId) {
      cursor = movedNewParentId;
    } else {
      cursor = node.parent_id;
    }
  }

  return names.reverse().join(" > ");
}

function handleDbError(error: unknown, res: Response) {
  const code = getDbErrorCode(error);

  if (code === "23505") {
    return sendConflict(res, "Location code already exists");
  }

  return sendInternalError(error, res);
}

function normalizedAppBaseUrl(): string {
  const raw = normalizeOptionalText(env.appBaseUrl) ?? `http://localhost:${env.port}`;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

function buildLocationScanPayload(code: string): { scanPath: string; scanUrl: string } {
  const scanPath = `/scan/location/${code}`;
  return {
    scanPath,
    scanUrl: `${normalizedAppBaseUrl()}${scanPath}`,
  };
}

locationsRouter.post("/locations", async (req, res) => {
  const name = asRequiredText(req.body.name);
  const code = asOptionalText(req.body.code);
  const type = asOptionalText(req.body.type);
  const description = asOptionalText(req.body.description);
  const imageUrl = asOptionalText(req.body.image_url);
  const parentId = asOptionalUuid(req.body.parent_id);

  if (!name) {
    return sendValidationError(res, "name is required");
  }

  if (parentId === "INVALID") {
    return sendValidationError(res, "parent_id must be a UUID or null");
  }

  const client = await pool.connect();
  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }
    if (!ensureWriteAccess(scope, res)) {
      return;
    }

    await client.query("BEGIN");

    if (parentId) {
      const parentScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
      const parent = await client.query(
        `
        SELECT id
        FROM locations
        WHERE id = $1 AND ${parentScope.sql}
        `,
        [parentId, ...parentScope.params]
      );
      if (parent.rowCount === 0) {
        await client.query("ROLLBACK");
        return sendValidationError(res, "parent_id does not exist");
      }
    }

    const result = await client.query<LocationRow>(
      `
      INSERT INTO locations(
        name,
        code,
        type,
        parent_id,
        description,
        image_url,
        owner_user_id,
        household_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [name, code, type, parentId, description, imageUrl, scope.ownerUserId, scope.householdId]
    );

    const created = result.rows[0];
    await ensureLocationQrCode(client, {
      locationId: created.id,
      ownerUserId: created.owner_user_id ?? scope.ownerUserId ?? null,
      householdId: created.household_id ?? scope.householdId ?? null,
    });

    await client.query("COMMIT");
    return res.status(201).json(created);
  } catch (error) {
    await client.query("ROLLBACK");
    return handleDbError(error, res);
  } finally {
    client.release();
  }
});

locationsRouter.get("/locations/tree", async (req, res) => {
  const rootId = normalizeOptionalText(req.query.root_id);

  if (rootId && !isUuid(rootId)) {
    return sendValidationError(res, "root_id must be a UUID");
  }

  const maxDepthRaw = Number(req.query.max_depth ?? 100);
  const maxDepth = Number.isFinite(maxDepthRaw)
    ? Math.min(Math.max(Math.trunc(maxDepthRaw), 1), 100)
    : 100;

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }

    let rows: LocationRow[] = [];

    if (rootId) {
      const rootScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 3);
      const recursiveScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 3);
      const result = await pool.query<LocationRow>(
        `
        WITH RECURSIVE tree AS (
          SELECT id, name, code, type, parent_id, description, image_url, created_at, updated_at, owner_user_id, 1 AS depth
          FROM locations
          WHERE id = $1 AND ${rootScope.sql}
          UNION ALL
          SELECT l.id, l.name, l.code, l.type, l.parent_id, l.description, l.image_url, l.created_at, l.updated_at, l.owner_user_id, tree.depth + 1
          FROM locations l
          JOIN tree ON l.parent_id = tree.id
          WHERE tree.depth < $2 AND ${recursiveScope.sql}
        )
        SELECT id, name, code, type, parent_id, description, image_url, created_at, updated_at, owner_user_id
        FROM tree
        ORDER BY name ASC
        `,
        [rootId, maxDepth, ...rootScope.params]
      );
      rows = result.rows;
      if (rows.length === 0) {
        return sendNotFound(res, "Root location not found");
      }
    } else {
      const allScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 1);
      const result = await pool.query<LocationRow>(
        `
        SELECT id, name, code, type, parent_id, description, image_url, created_at, updated_at, owner_user_id
        FROM locations
        WHERE ${allScope.sql}
        ORDER BY name ASC
        `,
        [...allScope.params]
      );
      rows = result.rows;
    }

    const byId = new Map<string, TreeNode>();

    for (const row of rows) {
      byId.set(row.id, { ...row, children: [] });
    }

    const roots: TreeNode[] = [];
    for (const node of byId.values()) {
      if (node.parent_id && byId.has(node.parent_id)) {
        const parent = byId.get(node.parent_id);
        parent?.children.push(node);
      } else {
        roots.push(node);
      }
    }

    const sortRecursive = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
      for (const node of nodes) {
        sortRecursive(node.children);
      }
    };

    sortRecursive(roots);

    return res.status(200).json({ nodes: roots });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

locationsRouter.get("/locations/:id/path", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid location id");
  }

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }

    const locationScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const recursiveScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 2);
    const result = await pool.query<{ id: string; name: string; path: string }>(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, name, 1 AS depth
        FROM locations
        WHERE id = $1 AND ${locationScope.sql}
        UNION ALL
        SELECT l.id, l.parent_id, l.name, ancestors.depth + 1
        FROM locations l
        JOIN ancestors ON ancestors.parent_id = l.id
        WHERE ${recursiveScope.sql}
      )
      SELECT
        $1::uuid AS id,
        (SELECT name FROM locations WHERE id = $1 AND ${locationScope.sql}) AS name,
        string_agg(name, ' > ' ORDER BY depth DESC) AS path
      FROM ancestors
      `,
      [id, ...locationScope.params]
    );

    if (!result.rows[0]?.name) {
      return sendNotFound(res, "Location not found");
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    return sendInternalError(error, res);
  }
});

locationsRouter.get("/locations/:id/qr", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid location id");
  }

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }

    const locationScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const location = await pool.query<{
      id: string;
      name: string;
      owner_user_id: string | null;
      household_id: string | null;
    }>(
      `
      SELECT id, name, owner_user_id, household_id
      FROM locations
      WHERE id = $1 AND ${locationScope.sql}
      `,
      [id, ...locationScope.params]
    );

    if (location.rowCount === 0) {
      return sendNotFound(res, "Location not found");
    }

    const qr = await pool.query<{
      id: string;
      location_id: string;
      code: string;
      created_at: string;
      updated_at: string;
    }>(
      `
      SELECT id, location_id, code, created_at, updated_at
      FROM location_qr_codes
      WHERE location_id = $1
      `,
      [id]
    );

    let qrRef = qr.rows[0] ?? null;
    if (!qrRef) {
      if (!canWriteInventory(scope)) {
        return res.status(503).json({ error: "QR reference not initialized for this location" });
      }
      qrRef = await ensureLocationQrCode(pool, {
        locationId: id,
        ownerUserId: location.rows[0].owner_user_id ?? scope.ownerUserId ?? null,
        householdId: location.rows[0].household_id ?? scope.householdId ?? null,
      });
    }

    const { scanPath, scanUrl } = buildLocationScanPayload(qrRef.code);

    return res.status(200).json({
      location_id: id,
      location_name: location.rows[0].name,
      qr_code: qrRef.code,
      scan_path: scanPath,
      scan_url: scanUrl,
      payload: scanUrl,
      created_at: qrRef.created_at,
      updated_at: qrRef.updated_at,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

locationsRouter.get("/scan/location/:code([0-9a-fA-F-]{36})", async (req, res) => {
  const code = req.params.code;
  if (!isUuid(code)) {
    return sendValidationError(res, "Invalid scan code");
  }

  const format = normalizeOptionalText(req.query.format)?.toLowerCase() ?? "";

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }

    const locationScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 2);
    const resolved = await pool.query<{ location_id: string; location_name: string }>(
      `
      SELECT l.id AS location_id, l.name AS location_name
      FROM location_qr_codes q
      JOIN locations l ON l.id = q.location_id
      WHERE q.code = $1 AND ${locationScope.sql}
      LIMIT 1
      `,
      [code, ...locationScope.params]
    );

    if (resolved.rowCount === 0) {
      return sendNotFound(res, "Scanned location not found");
    }

    const locationId = resolved.rows[0].location_id;
    const pathRootScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const pathRecursiveScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 2);
    const pathResult = await pool.query<{ path: string }>(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, name, 1 AS depth
        FROM locations
        WHERE id = $1 AND ${pathRootScope.sql}
        UNION ALL
        SELECT l.id, l.parent_id, l.name, ancestors.depth + 1
        FROM locations l
        JOIN ancestors ON ancestors.parent_id = l.id
        WHERE ${pathRecursiveScope.sql}
      )
      SELECT string_agg(name, ' > ' ORDER BY depth DESC) AS path
      FROM ancestors
      `,
      [locationId, ...pathRootScope.params]
    );

    const { scanPath, scanUrl } = buildLocationScanPayload(code);
    if (format === "json") {
      return res.status(200).json({
        qr_code: code,
        location_id: locationId,
        location_name: resolved.rows[0].location_name,
        path: pathResult.rows[0]?.path ?? resolved.rows[0].location_name,
        scan_path: scanPath,
        scan_url: scanUrl,
      });
    }

    const redirectPath = `/?location_id=${encodeURIComponent(locationId)}&scan_code=${encodeURIComponent(code)}`;
    return res.redirect(302, redirectPath);
  } catch (error) {
    return sendInternalError(error, res);
  }
});

locationsRouter.get("/locations/:id/verification/checklist", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid location id");
  }

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }

    const locationScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const recursiveScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 2);
    const itemScope = inventoryScopeSql(scope, "i.household_id", "i.owner_user_id", 2);

    const location = await pool.query<{ id: string; name: string }>(
      `
      SELECT id, name
      FROM locations
      WHERE id = $1 AND ${locationScope.sql}
      `,
      [id, ...locationScope.params]
    );

    if (location.rowCount === 0) {
      return sendNotFound(res, "Location not found");
    }

    const locationPath = await pool.query<{ path: string | null }>(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, name, 1 AS depth
        FROM locations
        WHERE id = $1 AND ${locationScope.sql}
        UNION ALL
        SELECT l.id, l.parent_id, l.name, ancestors.depth + 1
        FROM locations l
        JOIN ancestors ON ancestors.parent_id = l.id
        WHERE ${recursiveScope.sql}
      )
      SELECT string_agg(name, ' > ' ORDER BY depth DESC) AS path
      FROM ancestors
      `,
      [id, ...locationScope.params]
    );

    const checklist = await pool.query<{
      id: string;
      name: string;
      location_id: string;
      location_path: string;
    }>(
      `
      WITH RECURSIVE subtree AS (
        SELECT id, parent_id, name, name::text AS path
        FROM locations
        WHERE id = $1 AND ${locationScope.sql}
        UNION ALL
        SELECT l.id, l.parent_id, l.name, subtree.path || ' > ' || l.name
        FROM locations l
        JOIN subtree ON l.parent_id = subtree.id
        WHERE ${recursiveScope.sql}
      )
      SELECT
        i.id,
        i.name,
        i.location_id,
        subtree.path AS location_path
      FROM items i
      JOIN subtree ON subtree.id = i.location_id
      WHERE ${itemScope.sql}
      ORDER BY subtree.path ASC, i.name ASC
      `,
      [id, ...locationScope.params]
    );

    return res.status(200).json({
      location: {
        id,
        name: location.rows[0].name,
        path: locationPath.rows[0]?.path ?? location.rows[0].name,
      },
      expected_count: checklist.rowCount ?? checklist.rows.length,
      generated_at: new Date().toISOString(),
      items: checklist.rows,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

locationsRouter.post("/locations/:id/move-impact", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid location id");
  }

  const parentIdRaw = req.body.parent_id;
  const parentId = parentIdRaw === null ? null : normalizeOptionalText(parentIdRaw);
  if (parentId && !isUuid(parentId)) {
    return sendValidationError(res, "parent_id must be UUID or null");
  }
  if (parentId === id) {
    return sendValidationError(res, "location cannot be its own parent");
  }

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }
    if (!ensureWriteAccess(scope, res)) {
      return;
    }

    const locationScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 1);
    const locationsResult = await pool.query<LocationPathNode>(
      `
      SELECT id, name, parent_id
      FROM locations
      WHERE ${locationScope.sql}
      `,
      [...locationScope.params]
    );

    const locationMapById = new Map<string, LocationPathNode>();
    const childrenByParent = new Map<string | null, string[]>();

    for (const row of locationsResult.rows) {
      locationMapById.set(row.id, row);
      const siblings = childrenByParent.get(row.parent_id) || [];
      siblings.push(row.id);
      childrenByParent.set(row.parent_id, siblings);
    }

    if (!locationMapById.has(id)) {
      return sendNotFound(res, "Location not found");
    }

    if (parentId && !locationMapById.has(parentId)) {
      return sendValidationError(res, "parent_id does not exist");
    }

    const descendantIds = collectDescendantIds(id, childrenByParent);
    if (parentId && descendantIds.includes(parentId)) {
      return sendValidationError(res, "Invalid move: would create a cycle");
    }

    const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const itemCountResult = await pool.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM items
      WHERE location_id = ANY($1::uuid[])
        AND ${itemScope.sql}
      `,
      [descendantIds, ...itemScope.params]
    );

    const sampleItemsResult = await pool.query<{ id: string; name: string; location_id: string }>(
      `
      SELECT id, name, location_id
      FROM items
      WHERE location_id = ANY($1::uuid[])
        AND ${itemScope.sql}
      ORDER BY name ASC
      LIMIT 10
      `,
      [descendantIds, ...itemScope.params]
    );

    const currentParentId = locationMapById.get(id)?.parent_id ?? null;
    const sample = sampleItemsResult.rows.map((item) => {
      const beforeLocationPath = renderLocationPath(item.location_id, locationMapById, null, null);
      const afterLocationPath = renderLocationPath(item.location_id, locationMapById, id, parentId);
      return {
        item_id: item.id,
        item_name: item.name,
        before_path: `${beforeLocationPath} > ${item.name}`,
        after_path: `${afterLocationPath} > ${item.name}`,
      };
    });

    return res.status(200).json({
      location_id: id,
      from_parent_id: currentParentId,
      to_parent_id: parentId,
      affected_locations: descendantIds.length,
      affected_items: Number(itemCountResult.rows[0]?.count ?? "0"),
      sample,
      sample_truncated:
        Number(itemCountResult.rows[0]?.count ?? "0") > sampleItemsResult.rows.length,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

locationsRouter.patch("/locations/:id", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid location id");
  }

  const updates: Array<{ key: string; value: string | null }> = [];

  if ("name" in req.body) {
    const name = normalizeOptionalText(req.body.name);
    if (!name) {
      return sendValidationError(res, "name cannot be empty");
    }
    updates.push({ key: "name", value: name });
  }

  if ("code" in req.body) {
    updates.push({ key: "code", value: normalizeOptionalText(req.body.code) });
  }

  if ("type" in req.body) {
    updates.push({ key: "type", value: normalizeOptionalText(req.body.type) });
  }

  if ("description" in req.body) {
    updates.push({ key: "description", value: normalizeOptionalText(req.body.description) });
  }

  if ("image_url" in req.body) {
    updates.push({ key: "image_url", value: normalizeOptionalText(req.body.image_url) });
  }

  if ("parent_id" in req.body) {
    const parentIdRaw = req.body.parent_id;
    const parentId = parentIdRaw === null ? null : normalizeOptionalText(parentIdRaw);

    if (parentId && !isUuid(parentId)) {
      return sendValidationError(res, "parent_id must be UUID or null");
    }

    if (parentId === id) {
      return sendValidationError(res, "location cannot be its own parent");
    }

    try {
      const scope = await resolveScope(req, res);
      if (!scope) {
        return;
      }
      if (!ensureWriteAccess(scope, res)) {
        return;
      }

      if (parentId) {
        const parentScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
        const parentCheck = await pool.query(
          `
          SELECT id
          FROM locations
          WHERE id = $1 AND ${parentScope.sql}
          `,
          [parentId, ...parentScope.params]
        );
        if (parentCheck.rowCount === 0) {
          return sendValidationError(res, "parent_id does not exist");
        }

        const cycleRootScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 3);
        const cycleRecursiveScope = inventoryScopeSql(
          scope,
          "l.household_id",
          "l.owner_user_id",
          3
        );
        const cycleCheck = await pool.query(
          `
          WITH RECURSIVE subtree AS (
            SELECT id
            FROM locations
            WHERE id = $1 AND ${cycleRootScope.sql}
            UNION ALL
            SELECT l.id
            FROM locations l
            JOIN subtree s ON l.parent_id = s.id
            WHERE ${cycleRecursiveScope.sql}
          )
          SELECT 1
          FROM subtree
          WHERE id = $2
          LIMIT 1
          `,
          [id, parentId, ...cycleRootScope.params]
        );

        if ((cycleCheck.rowCount ?? 0) > 0) {
          return sendValidationError(res, "Invalid move: would create a cycle");
        }
      }

      updates.push({ key: "parent_id", value: parentId });
    } catch (error) {
      return sendInternalError(error, res);
    }
  }

  if (updates.length === 0) {
    return sendValidationError(res, "No valid fields provided");
  }

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }
    if (!ensureWriteAccess(scope, res)) {
      return;
    }

    const setClause = updates.map((entry, index) => `${entry.key} = $${index + 1}`).join(", ");
    const values = updates.map((entry) => entry.value);
    const locationScope = inventoryScopeSql(
      scope,
      "household_id",
      "owner_user_id",
      updates.length + 2
    );

    const result = await pool.query<LocationRow>(
      `
      UPDATE locations
      SET ${setClause}
      WHERE id = $${updates.length + 1}
        AND ${locationScope.sql}
      RETURNING *
      `,
      [...values, id, ...locationScope.params]
    );

    if (result.rowCount === 0) {
      return sendNotFound(res, "Location not found");
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    return handleDbError(error, res);
  }
});

locationsRouter.delete("/locations/:id", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid location id");
  }

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }
    if (!ensureWriteAccess(scope, res)) {
      return;
    }

    const locationScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const [location, children, items] = await Promise.all([
      pool.query(`SELECT id FROM locations WHERE id = $1 AND ${locationScope.sql}`, [
        id,
        ...locationScope.params,
      ]),
      pool.query(`SELECT 1 FROM locations WHERE parent_id = $1 AND ${locationScope.sql} LIMIT 1`, [
        id,
        ...locationScope.params,
      ]),
      pool.query(`SELECT 1 FROM items WHERE location_id = $1 AND ${itemScope.sql} LIMIT 1`, [
        id,
        ...itemScope.params,
      ]),
    ]);

    if (location.rowCount === 0) {
      return sendNotFound(res, "Location not found");
    }

    if ((children.rowCount ?? 0) > 0 || (items.rowCount ?? 0) > 0) {
      return sendConflict(res, "Cannot delete location with children or items");
    }

    await pool.query(`DELETE FROM locations WHERE id = $1 AND ${locationScope.sql}`, [
      id,
      ...locationScope.params,
    ]);
    return res.status(204).send();
  } catch (error) {
    return sendInternalError(error, res);
  }
});

export default locationsRouter;
