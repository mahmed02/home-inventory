import { Router } from "express";
import { markRawResponse } from "../middleware/http";
import { pool } from "../db/pool";
import { ownerScopeSql, requestOwnerUserId } from "../auth/ownerScope";
import { normalizeOptionalText } from "../utils";

const shortcutRouter = Router();

async function lookupTopItem(
  q: string,
  ownerUserId: string | null
): Promise<{ item: string | null; location_path: string | null; notes: string }> {
  const needle = `%${q}%`;

  const result = await pool.query<{
    item: string;
    location_path: string;
    notes: string | null;
    rank: number;
  }>(
    `
    WITH RECURSIVE location_paths AS (
      SELECT id, parent_id, name, name::text AS path
      FROM locations
      WHERE parent_id IS NULL AND ${ownerScopeSql("owner_user_id", 2)}
      UNION ALL
      SELECT l.id, l.parent_id, l.name, lp.path || ' > ' || l.name
      FROM locations l
      JOIN location_paths lp ON l.parent_id = lp.id
      WHERE ${ownerScopeSql("l.owner_user_id", 2)}
    )
    SELECT
      i.name AS item,
      lp.path AS location_path,
      i.description AS notes,
      CASE
        WHEN i.name ILIKE $1 THEN 1
        WHEN array_to_string(i.keywords, ' ') ILIKE $1 THEN 2
        ELSE 3
      END AS rank
    FROM items i
    JOIN location_paths lp ON lp.id = i.location_id
    WHERE
      ${ownerScopeSql("i.owner_user_id", 2)} AND (
        i.name ILIKE $1 OR
        COALESCE(i.description, '') ILIKE $1 OR
        array_to_string(i.keywords, ' ') ILIKE $1
      )
    ORDER BY rank ASC, i.name ASC
    LIMIT 1
    `,
    [needle, ownerUserId]
  );

  if (result.rowCount === 0) {
    return {
      item: null,
      location_path: null,
      notes: "I couldn't find that item.",
    };
  }

  const row = result.rows[0];
  return {
    item: row.item,
    location_path: row.location_path,
    notes: row.notes ?? "No additional notes.",
  };
}

shortcutRouter.get("/api/items/lookup", async (req, res) => {
  const ownerUserId = requestOwnerUserId(req);
  markRawResponse(res);
  const q = normalizeOptionalText(req.query.q);
  if (!q) {
    return res.status(400).json({ error: "q is required" });
  }

  try {
    const payload = await lookupTopItem(q, ownerUserId);
    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

shortcutRouter.get("/shortcut/find-item", async (req, res) => {
  const ownerUserId = requestOwnerUserId(req);
  markRawResponse(res);
  const q = normalizeOptionalText(req.query.q);
  if (!q) {
    return res.status(400).json({ error: "q is required" });
  }

  try {
    const payload = await lookupTopItem(q, ownerUserId);
    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default shortcutRouter;
