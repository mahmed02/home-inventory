import { Response, Router } from "express";
import {
  getDbErrorCode,
  sendConflict,
  sendInternalError,
  sendNotFound,
  sendValidationError,
} from "../middleware/http";
import { asOptionalText, asOptionalUuid, asRequiredText } from "../middleware/validation";
import { pool } from "../db/pool";
import { resolvePrimaryHouseholdIdForUser } from "../auth/households";
import { LocationRow } from "../types";
import { ownerScopeSql, requestOwnerUserId } from "../auth/ownerScope";
import { isUuid, normalizeOptionalText } from "../utils";

const locationsRouter = Router();

type TreeNode = LocationRow & { children: TreeNode[] };

function handleDbError(error: unknown, res: Response) {
  const code = getDbErrorCode(error);

  if (code === "23505") {
    return sendConflict(res, "Location code already exists");
  }

  return sendInternalError(error, res);
}

locationsRouter.post("/locations", async (req, res) => {
  const ownerUserId = requestOwnerUserId(req);
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

  try {
    const householdId = await resolvePrimaryHouseholdIdForUser(ownerUserId);

    if (parentId) {
      const parent = await pool.query(
        `
        SELECT id
        FROM locations
        WHERE id = $1 AND ${ownerScopeSql("owner_user_id", 2)}
        `,
        [parentId, ownerUserId]
      );
      if (parent.rowCount === 0) {
        return sendValidationError(res, "parent_id does not exist");
      }
    }

    const result = await pool.query<LocationRow>(
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
      [name, code, type, parentId, description, imageUrl, ownerUserId, householdId]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return handleDbError(error, res);
  }
});

locationsRouter.get("/locations/tree", async (req, res) => {
  const ownerUserId = requestOwnerUserId(req);
  const rootId = normalizeOptionalText(req.query.root_id);

  if (rootId && !isUuid(rootId)) {
    return sendValidationError(res, "root_id must be a UUID");
  }

  const maxDepthRaw = Number(req.query.max_depth ?? 100);
  const maxDepth = Number.isFinite(maxDepthRaw)
    ? Math.min(Math.max(Math.trunc(maxDepthRaw), 1), 100)
    : 100;

  try {
    let rows: LocationRow[] = [];

    if (rootId) {
      const result = await pool.query<LocationRow>(
        `
        WITH RECURSIVE tree AS (
          SELECT id, name, code, type, parent_id, description, image_url, created_at, updated_at, owner_user_id, 1 AS depth
          FROM locations
          WHERE id = $1 AND ${ownerScopeSql("owner_user_id", 3)}
          UNION ALL
          SELECT l.id, l.name, l.code, l.type, l.parent_id, l.description, l.image_url, l.created_at, l.updated_at, l.owner_user_id, tree.depth + 1
          FROM locations l
          JOIN tree ON l.parent_id = tree.id
          WHERE tree.depth < $2 AND ${ownerScopeSql("l.owner_user_id", 3)}
        )
        SELECT id, name, code, type, parent_id, description, image_url, created_at, updated_at, owner_user_id
        FROM tree
        ORDER BY name ASC
        `,
        [rootId, maxDepth, ownerUserId]
      );
      rows = result.rows;
      if (rows.length === 0) {
        return sendNotFound(res, "Root location not found");
      }
    } else {
      const result = await pool.query<LocationRow>(
        `
        SELECT id, name, code, type, parent_id, description, image_url, created_at, updated_at, owner_user_id
        FROM locations
        WHERE ${ownerScopeSql("owner_user_id", 1)}
        ORDER BY name ASC
        `,
        [ownerUserId]
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
  const ownerUserId = requestOwnerUserId(req);
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid location id");
  }

  try {
    const result = await pool.query<{ id: string; name: string; path: string }>(
      `
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, name, 1 AS depth
        FROM locations
        WHERE id = $1 AND ${ownerScopeSql("owner_user_id", 2)}
        UNION ALL
        SELECT l.id, l.parent_id, l.name, ancestors.depth + 1
        FROM locations l
        JOIN ancestors ON ancestors.parent_id = l.id
        WHERE ${ownerScopeSql("l.owner_user_id", 2)}
      )
      SELECT
        $1::uuid AS id,
        (SELECT name FROM locations WHERE id = $1 AND ${ownerScopeSql("owner_user_id", 2)}) AS name,
        string_agg(name, ' > ' ORDER BY depth DESC) AS path
      FROM ancestors
      `,
      [id, ownerUserId]
    );

    if (!result.rows[0]?.name) {
      return sendNotFound(res, "Location not found");
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    return sendInternalError(error, res);
  }
});

locationsRouter.patch("/locations/:id", async (req, res) => {
  const ownerUserId = requestOwnerUserId(req);
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
      if (parentId) {
        const parentCheck = await pool.query(
          `
          SELECT id
          FROM locations
          WHERE id = $1 AND ${ownerScopeSql("owner_user_id", 2)}
          `,
          [parentId, ownerUserId]
        );
        if (parentCheck.rowCount === 0) {
          return sendValidationError(res, "parent_id does not exist");
        }

        const cycleCheck = await pool.query(
          `
          WITH RECURSIVE subtree AS (
            SELECT id
            FROM locations
            WHERE id = $1 AND ${ownerScopeSql("owner_user_id", 3)}
            UNION ALL
            SELECT l.id
            FROM locations l
            JOIN subtree s ON l.parent_id = s.id
            WHERE ${ownerScopeSql("l.owner_user_id", 3)}
          )
          SELECT 1
          FROM subtree
          WHERE id = $2
          LIMIT 1
          `,
          [id, parentId, ownerUserId]
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
    const setClause = updates.map((entry, index) => `${entry.key} = $${index + 1}`).join(", ");
    const values = updates.map((entry) => entry.value);

    const result = await pool.query<LocationRow>(
      `
      UPDATE locations
      SET ${setClause}
      WHERE id = $${updates.length + 1}
        AND ${ownerScopeSql("owner_user_id", updates.length + 2)}
      RETURNING *
      `,
      [...values, id, ownerUserId]
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
  const ownerUserId = requestOwnerUserId(req);
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid location id");
  }

  try {
    const [location, children, items] = await Promise.all([
      pool.query(
        `SELECT id FROM locations WHERE id = $1 AND ${ownerScopeSql("owner_user_id", 2)}`,
        [id, ownerUserId]
      ),
      pool.query(
        `SELECT 1 FROM locations WHERE parent_id = $1 AND ${ownerScopeSql("owner_user_id", 2)} LIMIT 1`,
        [id, ownerUserId]
      ),
      pool.query(
        `SELECT 1 FROM items WHERE location_id = $1 AND ${ownerScopeSql("owner_user_id", 2)} LIMIT 1`,
        [id, ownerUserId]
      ),
    ]);

    if (location.rowCount === 0) {
      return sendNotFound(res, "Location not found");
    }

    if ((children.rowCount ?? 0) > 0 || (items.rowCount ?? 0) > 0) {
      return sendConflict(res, "Cannot delete location with children or items");
    }

    await pool.query(
      `DELETE FROM locations WHERE id = $1 AND ${ownerScopeSql("owner_user_id", 2)}`,
      [id, ownerUserId]
    );
    return res.status(204).send();
  } catch (error) {
    return sendInternalError(error, res);
  }
});

export default locationsRouter;
