import { Request, Response, Router } from "express";
import {
  getDbErrorCode,
  sendInternalError,
  sendNotFound,
  sendValidationError,
} from "../middleware/http";
import {
  asKeywords,
  asOptionalNonNegativeInteger,
  asOptionalText,
  asRequiredPositiveInteger,
  asRequiredText,
  asRequiredUuid,
} from "../middleware/validation";
import { pool } from "../db/pool";
import { recordItemMovement } from "../db/movementHistory";
import { env } from "../config/env";
import { deriveThumbnailUrlFromImageUrl } from "../media/thumbnails";
import { deleteItemEmbedding, upsertItemEmbedding } from "../search/itemEmbeddings";
import {
  isSemanticSearchMode,
  invalidateSemanticSearchCacheForScope,
  semanticItemSearch,
  SemanticSearchMode,
} from "../search/semanticSearch";
import { ItemRow } from "../types";
import {
  InventoryScope,
  canWriteInventory,
  inventoryScopeSql,
  resolveInventoryScope,
} from "../auth/inventoryScope";
import { isUuid, normalizeOptionalText, readLimitOffset } from "../utils";

const itemsRouter = Router();
const MAX_DB_INT = 2_147_483_647;

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

function dbError(error: unknown, res: Response) {
  const code = getDbErrorCode(error);

  if (code === "23503") {
    return res.status(404).json({ error: "location_id not found" });
  }

  return sendInternalError(error, res);
}

function parseOptionalTimestamp(
  value: unknown
): { ok: true; value: string | null } | { ok: false; message: string } {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return { ok: true, value: null };
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, message: "from/to must be a valid ISO date or datetime" };
  }

  return { ok: true, value: parsed.toISOString() };
}

itemsRouter.post("/items", async (req, res) => {
  const name = asRequiredText(req.body.name);
  const description = asOptionalText(req.body.description);
  const imageUrl = asOptionalText(req.body.image_url);
  const locationId = asRequiredUuid(req.body.location_id);
  const keywords = asKeywords(req.body.keywords) ?? [];
  const quantity = asOptionalNonNegativeInteger(req.body.quantity);

  if (quantity === "INVALID") {
    return sendValidationError(res, "quantity must be a non-negative integer or null");
  }

  if (!name || locationId === "INVALID") {
    return sendValidationError(res, "name and location_id are required");
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
    const locationScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);

    const location = await client.query(
      `
      SELECT id
      FROM locations
      WHERE id = $1 AND ${locationScope.sql}
      `,
      [locationId, ...locationScope.params]
    );
    if (location.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "location_id not found" });
    }

    const result = await client.query<ItemRow>(
      `
      INSERT INTO items(
        name,
        description,
        keywords,
        quantity,
        location_id,
        image_url,
        owner_user_id,
        household_id
      )
      VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        name,
        description,
        keywords,
        quantity,
        locationId,
        imageUrl,
        scope.ownerUserId,
        scope.householdId,
      ]
    );

    await upsertItemEmbedding(result.rows[0], client);
    await invalidateSemanticSearchCacheForScope(scope, client);
    await client.query("COMMIT");
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    return dbError(error, res);
  } finally {
    client.release();
  }
});

itemsRouter.get("/items/:id([0-9a-fA-F-]{36})", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid item id");
  }

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }
    const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);

    const result = await pool.query<ItemRow>(
      `
      SELECT *
      FROM items
      WHERE id = $1 AND ${itemScope.sql}
      `,
      [id, ...itemScope.params]
    );
    if (result.rowCount === 0) {
      return sendNotFound(res, "Item not found");
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    return sendInternalError(error, res);
  }
});

itemsRouter.get("/items/:id([0-9a-fA-F-]{36})/quantity", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid item id");
  }

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }

    const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const result = await pool.query<{ id: string; name: string; quantity: number | null }>(
      `
      SELECT id, name, quantity
      FROM items
      WHERE id = $1 AND ${itemScope.sql}
      LIMIT 1
      `,
      [id, ...itemScope.params]
    );
    if (result.rowCount === 0) {
      return sendNotFound(res, "Item not found");
    }

    const row = result.rows[0];
    return res.status(200).json({
      item_id: row.id,
      item_name: row.name,
      quantity: row.quantity ?? null,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

itemsRouter.get("/items/:id([0-9a-fA-F-]{36})/history", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid item id");
  }

  const fromParsed = parseOptionalTimestamp(req.query.from);
  if (!fromParsed.ok) {
    return sendValidationError(res, fromParsed.message);
  }
  const toParsed = parseOptionalTimestamp(req.query.to);
  if (!toParsed.ok) {
    return sendValidationError(res, toParsed.message);
  }

  if (fromParsed.value && toParsed.value && fromParsed.value > toParsed.value) {
    return sendValidationError(res, "from must be less than or equal to to");
  }

  const { limit, offset } = readLimitOffset(req);

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }

    const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const itemExists = await pool.query(
      `
      SELECT id
      FROM items
      WHERE id = $1 AND ${itemScope.sql}
      `,
      [id, ...itemScope.params]
    );
    if (itemExists.rowCount === 0) {
      return sendNotFound(res, "Item not found");
    }

    const historyScope = inventoryScopeSql(scope, "mh.household_id", "mh.owner_user_id", 2);
    const rootScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const recursiveScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 2);

    const whereParts = ["mh.item_id = $1", historyScope.sql];
    const values: Array<string | number | null> = [id, ...historyScope.params];

    if (fromParsed.value) {
      values.push(fromParsed.value);
      whereParts.push(`mh.created_at >= $${values.length}`);
    }
    if (toParsed.value) {
      values.push(toParsed.value);
      whereParts.push(`mh.created_at <= $${values.length}`);
    }

    values.push(limit, offset);
    const limitParam = `$${values.length - 1}`;
    const offsetParam = `$${values.length}`;

    const history = await pool.query<{
      id: string;
      item_id: string;
      from_location_id: string;
      to_location_id: string;
      from_location_path: string | null;
      to_location_path: string | null;
      moved_by_user_id: string | null;
      moved_by_email: string | null;
      moved_by_display_name: string | null;
      source: string;
      created_at: string;
      total_count: string;
    }>(
      `
      WITH RECURSIVE location_paths AS (
        SELECT id, parent_id, name, name::text AS path
        FROM locations
        WHERE parent_id IS NULL AND ${rootScope.sql}
        UNION ALL
        SELECT l.id, l.parent_id, l.name, lp.path || ' > ' || l.name
        FROM locations l
        JOIN location_paths lp ON l.parent_id = lp.id
        WHERE ${recursiveScope.sql}
      ),
      filtered AS (
        SELECT
          mh.id,
          mh.item_id,
          mh.from_location_id,
          mh.to_location_id,
          from_lp.path AS from_location_path,
          to_lp.path AS to_location_path,
          mh.moved_by_user_id,
          u.email AS moved_by_email,
          u.display_name AS moved_by_display_name,
          mh.source,
          mh.created_at,
          COUNT(*) OVER()::text AS total_count
        FROM movement_history mh
        LEFT JOIN location_paths from_lp ON from_lp.id = mh.from_location_id
        LEFT JOIN location_paths to_lp ON to_lp.id = mh.to_location_id
        LEFT JOIN users u ON u.id = mh.moved_by_user_id
        WHERE ${whereParts.join(" AND ")}
      )
      SELECT
        id,
        item_id,
        from_location_id,
        to_location_id,
        from_location_path,
        to_location_path,
        moved_by_user_id,
        moved_by_email,
        moved_by_display_name,
        source,
        created_at,
        total_count
      FROM filtered
      ORDER BY created_at DESC, id DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
      `,
      values
    );

    const total = Number(history.rows[0]?.total_count ?? "0");
    const events = history.rows.map((row) => ({
      id: row.id,
      item_id: row.item_id,
      from_location_id: row.from_location_id,
      to_location_id: row.to_location_id,
      from_location_path: row.from_location_path,
      to_location_path: row.to_location_path,
      moved_by_user_id: row.moved_by_user_id,
      moved_by: row.moved_by_user_id
        ? {
            id: row.moved_by_user_id,
            email: row.moved_by_email,
            display_name: row.moved_by_display_name,
          }
        : null,
      source: row.source,
      created_at: row.created_at,
    }));

    return res.status(200).json({
      item_id: id,
      events,
      total,
      limit,
      offset,
      order: "desc",
      from: fromParsed.value,
      to: toParsed.value,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

itemsRouter.get("/items", async (req, res) => {
  const locationId = normalizeOptionalText(req.query.location_id);
  if (locationId && !isUuid(locationId)) {
    return sendValidationError(res, "location_id must be UUID");
  }

  const { limit, offset } = readLimitOffset(req);

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }

    const baseScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 1);
    const values: Array<string | number | null> = [...baseScope.params];
    const whereParts = [baseScope.sql];

    if (locationId) {
      values.push(locationId);
      whereParts.push(`location_id = $${values.length}`);
    }

    values.push(limit, offset);

    const limitParam = `$${values.length - 1}`;
    const offsetParam = `$${values.length}`;

    const result = await pool.query<ItemRow>(
      `
      SELECT *
      FROM items
      WHERE ${whereParts.join(" AND ")}
      ORDER BY name ASC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
      `,
      values
    );

    return res.status(200).json({ items: result.rows, limit, offset });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

itemsRouter.patch("/items/:id([0-9a-fA-F-]{36})", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid item id");
  }

  const updates: Array<{ key: string; value: unknown }> = [];
  let pendingLocationId: string | null = null;

  if ("name" in req.body) {
    const name = normalizeOptionalText(req.body.name);
    if (!name) {
      return sendValidationError(res, "name cannot be empty");
    }
    updates.push({ key: "name", value: name });
  }

  if ("description" in req.body) {
    updates.push({ key: "description", value: normalizeOptionalText(req.body.description) });
  }

  if ("keywords" in req.body) {
    const keywords = Array.isArray(req.body.keywords)
      ? req.body.keywords.filter((k: unknown): k is string => typeof k === "string")
      : null;

    if (!keywords) {
      return sendValidationError(res, "keywords must be a string array");
    }
    updates.push({ key: "keywords", value: keywords });
  }

  if ("location_id" in req.body) {
    const locationId = normalizeOptionalText(req.body.location_id);
    if (!locationId || !isUuid(locationId)) {
      return sendValidationError(res, "location_id must be UUID");
    }
    pendingLocationId = locationId;
    updates.push({ key: "location_id", value: locationId });
  }

  if ("image_url" in req.body) {
    updates.push({ key: "image_url", value: normalizeOptionalText(req.body.image_url) });
  }

  if ("quantity" in req.body) {
    const quantity = asOptionalNonNegativeInteger(req.body.quantity);
    if (quantity === "INVALID") {
      return sendValidationError(res, "quantity must be a non-negative integer or null");
    }
    updates.push({ key: "quantity", value: quantity });
  }

  if (updates.length === 0) {
    return sendValidationError(res, "No valid fields provided");
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
    if (pendingLocationId) {
      const locationScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
      const location = await client.query(
        `
        SELECT id
        FROM locations
        WHERE id = $1 AND ${locationScope.sql}
        `,
        [pendingLocationId, ...locationScope.params]
      );
      if (location.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "location_id not found" });
      }
    }

    const currentItemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const currentItem = await client.query<
      Pick<ItemRow, "id" | "location_id" | "owner_user_id" | "household_id">
    >(
      `
      SELECT id, location_id, owner_user_id, household_id
      FROM items
      WHERE id = $1
        AND ${currentItemScope.sql}
      FOR UPDATE
      `,
      [id, ...currentItemScope.params]
    );

    if (currentItem.rowCount === 0) {
      await client.query("ROLLBACK");
      return sendNotFound(res, "Item not found");
    }

    const setClause = updates.map((entry, index) => `${entry.key} = $${index + 1}`).join(", ");

    const values = updates.map((entry) => entry.value);
    const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", updates.length + 2);

    const result = await client.query<ItemRow>(
      `
      UPDATE items
      SET ${setClause}
      WHERE id = $${updates.length + 1}
        AND ${itemScope.sql}
      RETURNING *
      `,
      [...values, id, ...itemScope.params]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return sendNotFound(res, "Item not found");
    }

    const previous = currentItem.rows[0];
    const next = result.rows[0];
    if (pendingLocationId && previous.location_id !== next.location_id) {
      await recordItemMovement(client, {
        itemId: next.id,
        fromLocationId: previous.location_id,
        toLocationId: next.location_id,
        movedByUserId: req.authUserId ?? null,
        ownerUserId: next.owner_user_id ?? previous.owner_user_id ?? null,
        householdId: next.household_id ?? previous.household_id ?? null,
        source: "api.items.patch",
      });
    }

    await upsertItemEmbedding(result.rows[0], client);
    await invalidateSemanticSearchCacheForScope(scope, client);
    await client.query("COMMIT");
    return res.status(200).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    return dbError(error, res);
  } finally {
    client.release();
  }
});

itemsRouter.patch("/items/:id([0-9a-fA-F-]{36})/quantity", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid item id");
  }

  const opRaw = normalizeOptionalText(req.body.op)?.toLowerCase() ?? "";
  if (opRaw !== "set" && opRaw !== "add" && opRaw !== "remove") {
    return sendValidationError(res, "op must be one of: set, add, remove");
  }

  let setQuantity: number | null = null;
  let amount: number | null = null;

  if (opRaw === "set") {
    const parsed = asOptionalNonNegativeInteger(req.body.quantity);
    if (parsed === "INVALID" || parsed === null) {
      return sendValidationError(res, "quantity must be a non-negative integer for op=set");
    }
    setQuantity = parsed;
  } else {
    const parsed = asRequiredPositiveInteger(req.body.amount ?? req.body.quantity);
    if (parsed === "INVALID") {
      return sendValidationError(res, "amount must be a positive integer for op=add/remove");
    }
    amount = parsed;
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
    const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const current = await client.query<{ id: string; name: string; quantity: number | null }>(
      `
      SELECT id, name, quantity
      FROM items
      WHERE id = $1 AND ${itemScope.sql}
      FOR UPDATE
      `,
      [id, ...itemScope.params]
    );

    if (current.rowCount === 0) {
      await client.query("ROLLBACK");
      return sendNotFound(res, "Item not found");
    }

    const currentRow = current.rows[0];
    const previousQuantity = currentRow.quantity ?? null;
    const baseQuantity = previousQuantity ?? 0;

    let nextQuantity = baseQuantity;
    if (opRaw === "set") {
      nextQuantity = setQuantity ?? 0;
    } else if (opRaw === "add") {
      nextQuantity = baseQuantity + (amount ?? 0);
      if (nextQuantity > MAX_DB_INT) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Quantity exceeds maximum supported value" });
      }
    } else {
      const delta = amount ?? 0;
      if (delta > baseQuantity) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `Cannot remove ${delta}; current quantity is ${baseQuantity}`,
        });
      }
      nextQuantity = baseQuantity - delta;
    }

    const updated = await client.query<{ id: string; name: string; quantity: number | null }>(
      `
      UPDATE items
      SET quantity = $1
      WHERE id = $2 AND ${itemScope.sql}
      RETURNING id, name, quantity
      `,
      [nextQuantity, id, ...itemScope.params]
    );

    if (updated.rowCount === 0) {
      await client.query("ROLLBACK");
      return sendNotFound(res, "Item not found");
    }

    await invalidateSemanticSearchCacheForScope(scope, client);
    await client.query("COMMIT");
    return res.status(200).json({
      item_id: updated.rows[0].id,
      item_name: updated.rows[0].name,
      op: opRaw,
      amount,
      previous_quantity: previousQuantity,
      quantity: updated.rows[0].quantity ?? null,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return sendInternalError(error, res);
  } finally {
    client.release();
  }
});

itemsRouter.delete("/items/:id([0-9a-fA-F-]{36})", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid item id");
  }

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }
    if (!ensureWriteAccess(scope, res)) {
      return;
    }

    const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const result = await pool.query(`DELETE FROM items WHERE id = $1 AND ${itemScope.sql}`, [
      id,
      ...itemScope.params,
    ]);
    if (result.rowCount === 0) {
      return sendNotFound(res, "Item not found");
    }

    try {
      await deleteItemEmbedding(id);
    } catch (indexError) {
      console.error("Search index delete failed", indexError);
    }

    await invalidateSemanticSearchCacheForScope(scope);

    return res.status(204).send();
  } catch (error) {
    return sendInternalError(error, res);
  }
});

itemsRouter.get("/items/search", async (req, res) => {
  const q = normalizeOptionalText(req.query.q);
  if (!q) {
    return sendValidationError(res, "q is required");
  }

  const { limit, offset } = readLimitOffset(req);
  const needle = `%${q}%`;

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }

    const rootScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const recursiveScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 2);
    const itemScope = inventoryScopeSql(scope, "i.household_id", "i.owner_user_id", 2);
    const result = await pool.query<{
      id: string;
      name: string;
      location_path: string;
      image_url: string | null;
      quantity: number | null;
      total_count: string;
    }>(
      `
      WITH RECURSIVE location_paths AS (
        SELECT id, parent_id, name, name::text AS path
        FROM locations
        WHERE parent_id IS NULL AND ${rootScope.sql}
        UNION ALL
        SELECT l.id, l.parent_id, l.name, lp.path || ' > ' || l.name
        FROM locations l
        JOIN location_paths lp ON l.parent_id = lp.id
        WHERE ${recursiveScope.sql}
      ),
      filtered AS (
        SELECT i.id, i.name, i.image_url, i.quantity, lp.path AS location_path
        FROM items i
        JOIN location_paths lp ON lp.id = i.location_id
        WHERE
          ${itemScope.sql} AND (
            i.name ILIKE $1 OR
            COALESCE(i.description, '') ILIKE $1 OR
            array_to_string(i.keywords, ' ') ILIKE $1
          )
      )
      SELECT id, name, image_url, quantity, location_path, COUNT(*) OVER()::text AS total_count
      FROM filtered
      ORDER BY name ASC
      LIMIT $3 OFFSET $4
      `,
      [needle, ...rootScope.params, limit, offset]
    );

    const total = Number(result.rows[0]?.total_count ?? "0");
    const results = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      image_url: row.image_url,
      thumbnail_url: deriveThumbnailUrlFromImageUrl(row.image_url, env.s3Bucket, env.awsRegion),
      quantity: row.quantity ?? null,
      location_path: row.location_path,
    }));

    return res.status(200).json({ results, total, limit, offset });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

itemsRouter.get("/items/search/semantic", async (req, res) => {
  const q = normalizeOptionalText(req.query.q);
  if (!q) {
    return sendValidationError(res, "q is required");
  }

  const modeRaw = normalizeOptionalText(req.query.mode)?.toLowerCase() ?? null;
  let mode: SemanticSearchMode = "hybrid";
  if (modeRaw) {
    if (!isSemanticSearchMode(modeRaw)) {
      return sendValidationError(res, "mode must be one of: hybrid, semantic, lexical");
    }
    mode = modeRaw;
  }
  const { limit, offset } = readLimitOffset(req);

  try {
    const scope = await resolveScope(req, res);
    if (!scope) {
      return;
    }

    const searched = await semanticItemSearch({
      scope,
      query: q,
      mode,
      limit,
      offset,
    });

    const results = searched.results.map((row) => ({
      id: row.id,
      name: row.name,
      image_url: row.image_url,
      thumbnail_url: deriveThumbnailUrlFromImageUrl(row.image_url, env.s3Bucket, env.awsRegion),
      quantity: row.quantity ?? null,
      location_path: row.location_path,
      score: row.score,
      lexical_score: row.lexical_score,
      semantic_score: row.semantic_score,
    }));

    return res.status(200).json({
      results,
      total: searched.total,
      limit,
      offset,
      mode,
    });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

export default itemsRouter;
