import { InventoryScope, inventoryScopeSql } from "../auth/inventoryScope";
import { pool } from "../db/pool";
import { roundConfidence } from "./intentParser";
import { InventoryAssistantResponse, ParsedInventoryIntent } from "./lookupTypes";

async function findLocationByQuery(
  locationQuery: string,
  scope: InventoryScope
): Promise<{ id: string; name: string; path: string } | null> {
  const needle = `%${locationQuery}%`;
  const rootScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 3);
  const recursiveScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 3);

  const result = await pool.query<{ id: string; name: string; path: string }>(
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
    )
    SELECT id, name, path
    FROM location_paths
    WHERE name ILIKE $1 OR path ILIKE $1
    ORDER BY
      CASE
        WHEN lower(name) = lower($2) THEN 0
        WHEN name ILIKE $1 THEN 1
        ELSE 2
      END,
      char_length(path) ASC,
      path ASC
    LIMIT 1
    `,
    [needle, locationQuery, ...rootScope.params]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
}

async function countItemsInLocationSubtree(
  locationId: string,
  scope: InventoryScope
): Promise<number> {
  const locationScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
  const recursiveLocationScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 2);
  const itemScope = inventoryScopeSql(scope, "i.household_id", "i.owner_user_id", 2);

  const result = await pool.query<{ total_count: string }>(
    `
    WITH RECURSIVE subtree AS (
      SELECT id
      FROM locations
      WHERE id = $1 AND ${locationScope.sql}
      UNION ALL
      SELECT l.id
      FROM locations l
      JOIN subtree s ON l.parent_id = s.id
      WHERE ${recursiveLocationScope.sql}
    )
    SELECT COUNT(*)::text AS total_count
    FROM items i
    JOIN subtree s ON s.id = i.location_id
    WHERE ${itemScope.sql}
    `,
    [locationId, ...locationScope.params]
  );

  return Number(result.rows[0]?.total_count ?? "0");
}

async function previewItemsInLocationSubtree(
  locationId: string,
  scope: InventoryScope
): Promise<string[]> {
  const locationScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
  const recursiveLocationScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 2);
  const itemScope = inventoryScopeSql(scope, "i.household_id", "i.owner_user_id", 2);

  const result = await pool.query<{ name: string }>(
    `
    WITH RECURSIVE subtree AS (
      SELECT id
      FROM locations
      WHERE id = $1 AND ${locationScope.sql}
      UNION ALL
      SELECT l.id
      FROM locations l
      JOIN subtree s ON l.parent_id = s.id
      WHERE ${recursiveLocationScope.sql}
    )
    SELECT i.name
    FROM items i
    JOIN subtree s ON s.id = i.location_id
    WHERE ${itemScope.sql}
    ORDER BY i.name ASC
    LIMIT 5
    `,
    [locationId, ...locationScope.params]
  );

  return result.rows.map((row) => row.name);
}

export async function listLocationIntent(
  parsed: ParsedInventoryIntent,
  scope: InventoryScope
): Promise<InventoryAssistantResponse> {
  const location = await findLocationByQuery(parsed.subject, scope);

  if (!location) {
    return {
      query: parsed.rawQuery,
      normalized_query: parsed.normalizedQuery,
      intent: parsed.intent,
      confidence: roundConfidence(parsed.confidence * 0.35),
      fallback: true,
      answer: `I couldn't find a location matching "${parsed.subject}".`,
      item: null,
      location_path: null,
      notes: "Try a location name like garage, basement, or kitchen.",
      match_count: 0,
      requires_confirmation: false,
    };
  }

  const totalItems = await countItemsInLocationSubtree(location.id, scope);
  const preview = await previewItemsInLocationSubtree(location.id, scope);

  if (totalItems === 0) {
    return {
      query: parsed.rawQuery,
      normalized_query: parsed.normalizedQuery,
      intent: parsed.intent,
      confidence: roundConfidence(parsed.confidence * 0.85),
      fallback: false,
      answer: `${location.path} is currently empty.`,
      item: null,
      location_path: location.path,
      notes: "No items are stored in that location yet.",
      match_count: 0,
      requires_confirmation: false,
    };
  }

  const itemPreview = preview.join(", ");
  return {
    query: parsed.rawQuery,
    normalized_query: parsed.normalizedQuery,
    intent: parsed.intent,
    confidence: roundConfidence(parsed.confidence * 0.9),
    fallback: false,
    answer: `I found ${totalItems} item(s) in ${location.path}. ${itemPreview ? `Examples: ${itemPreview}.` : ""}`,
    item: preview[0] ?? null,
    location_path: location.path,
    notes: itemPreview ? `Examples: ${itemPreview}.` : "No preview available.",
    match_count: totalItems,
    requires_confirmation: false,
  };
}
