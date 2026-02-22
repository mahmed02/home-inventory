import { Response, Router } from "express";
import {
  getDbErrorCode,
  sendInternalError,
  sendNotFound,
  sendValidationError,
} from "../middleware/http";
import {
  asKeywords,
  asOptionalText,
  asRequiredText,
  asRequiredUuid,
} from "../middleware/validation";
import { pool } from "../db/pool";
import { env } from "../config/env";
import { deriveThumbnailUrlFromImageUrl } from "../media/thumbnails";
import { ItemRow } from "../types";
import { isUuid, normalizeOptionalText, readLimitOffset } from "../utils";

const itemsRouter = Router();

function dbError(error: unknown, res: Response) {
  const code = getDbErrorCode(error);

  if (code === "23503") {
    return res.status(404).json({ error: "location_id not found" });
  }

  return sendInternalError(error, res);
}

itemsRouter.post("/items", async (req, res) => {
  const name = asRequiredText(req.body.name);
  const description = asOptionalText(req.body.description);
  const imageUrl = asOptionalText(req.body.image_url);
  const locationId = asRequiredUuid(req.body.location_id);
  const keywords = asKeywords(req.body.keywords) ?? [];

  if (!name || locationId === "INVALID") {
    return sendValidationError(res, "name and location_id are required");
  }

  try {
    const result = await pool.query<ItemRow>(
      `
      INSERT INTO items(name, description, keywords, location_id, image_url)
      VALUES ($1, $2, $3::text[], $4, $5)
      RETURNING *
      `,
      [name, description, keywords, locationId, imageUrl]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return dbError(error, res);
  }
});

itemsRouter.get("/items/:id([0-9a-fA-F-]{36})", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid item id");
  }

  try {
    const result = await pool.query<ItemRow>("SELECT * FROM items WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return sendNotFound(res, "Item not found");
    }

    return res.status(200).json(result.rows[0]);
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
    const values: Array<string | number> = [];
    let whereClause = "";

    if (locationId) {
      whereClause = "WHERE location_id = $1";
      values.push(locationId);
    }

    values.push(limit, offset);

    const limitParam = `$${values.length - 1}`;
    const offsetParam = `$${values.length}`;

    const result = await pool.query<ItemRow>(
      `
      SELECT *
      FROM items
      ${whereClause}
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
    updates.push({ key: "location_id", value: locationId });
  }

  if ("image_url" in req.body) {
    updates.push({ key: "image_url", value: normalizeOptionalText(req.body.image_url) });
  }

  if (updates.length === 0) {
    return sendValidationError(res, "No valid fields provided");
  }

  try {
    const setClause = updates.map((entry, index) => `${entry.key} = $${index + 1}`).join(", ");

    const values = updates.map((entry) => entry.value);

    const result = await pool.query<ItemRow>(
      `
      UPDATE items
      SET ${setClause}
      WHERE id = $${updates.length + 1}
      RETURNING *
      `,
      [...values, id]
    );

    if (result.rowCount === 0) {
      return sendNotFound(res, "Item not found");
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    return dbError(error, res);
  }
});

itemsRouter.delete("/items/:id([0-9a-fA-F-]{36})", async (req, res) => {
  const id = req.params.id;
  if (!isUuid(id)) {
    return sendValidationError(res, "Invalid item id");
  }

  try {
    const result = await pool.query("DELETE FROM items WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return sendNotFound(res, "Item not found");
    }

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
    const result = await pool.query<{
      id: string;
      name: string;
      location_path: string;
      image_url: string | null;
      total_count: string;
    }>(
      `
      WITH RECURSIVE location_paths AS (
        SELECT id, parent_id, name, name::text AS path
        FROM locations
        WHERE parent_id IS NULL
        UNION ALL
        SELECT l.id, l.parent_id, l.name, lp.path || ' > ' || l.name
        FROM locations l
        JOIN location_paths lp ON l.parent_id = lp.id
      ),
      filtered AS (
        SELECT i.id, i.name, i.image_url, lp.path AS location_path
        FROM items i
        JOIN location_paths lp ON lp.id = i.location_id
        WHERE
          i.name ILIKE $1 OR
          COALESCE(i.description, '') ILIKE $1 OR
          array_to_string(i.keywords, ' ') ILIKE $1
      )
      SELECT id, name, image_url, location_path, COUNT(*) OVER()::text AS total_count
      FROM filtered
      ORDER BY name ASC
      LIMIT $2 OFFSET $3
      `,
      [needle, limit, offset]
    );

    const total = Number(result.rows[0]?.total_count ?? "0");
    const results = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      image_url: row.image_url,
      thumbnail_url: deriveThumbnailUrlFromImageUrl(row.image_url, env.s3Bucket, env.awsRegion),
      location_path: row.location_path,
    }));

    return res.status(200).json({ results, total, limit, offset });
  } catch (error) {
    return sendInternalError(error, res);
  }
});

export default itemsRouter;
