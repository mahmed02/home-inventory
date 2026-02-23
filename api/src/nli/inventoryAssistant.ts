import { InventoryScope, inventoryScopeSql } from "../auth/inventoryScope";
import { pool } from "../db/pool";
import { semanticItemSearch } from "../search/semanticSearch";

export type InventoryIntent = "find_item" | "list_location" | "count_items" | "unsupported_action";

export type ParsedInventoryIntent = {
  intent: InventoryIntent;
  subject: string;
  confidence: number;
  rawQuery: string;
  normalizedQuery: string;
};

export type InventoryAssistantResponse = {
  query: string;
  normalized_query: string;
  intent: InventoryIntent;
  confidence: number;
  fallback: boolean;
  answer: string;
  item: string | null;
  location_path: string | null;
  notes: string;
  match_count: number;
  requires_confirmation: boolean;
};

function roundConfidence(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 100) / 100;
}

function normalizePunctuation(value: string): string {
  return value
    .trim()
    .replace(/[\s]+/g, " ")
    .replace(/[?.!]+$/g, "");
}

function cleanupSubject(raw: string): string {
  return normalizePunctuation(raw)
    .replace(/^(the|a|an|my|our|any)\s+/i, "")
    .replace(/\s+(please|in inventory|in the inventory)$/i, "")
    .trim();
}

export function parseInventoryIntent(query: string): ParsedInventoryIntent {
  const normalizedQuery = normalizePunctuation(query).toLowerCase();

  const unsupportedMatch = normalizedQuery.match(
    /^(move|delete|remove|rename|update|edit)\s+(.+)$/i
  );
  if (unsupportedMatch) {
    const subject = cleanupSubject(unsupportedMatch[2]);
    return {
      intent: "unsupported_action",
      subject: subject || normalizedQuery,
      confidence: 0.96,
      rawQuery: query,
      normalizedQuery,
    };
  }

  const listLocationMatch = normalizedQuery.match(
    /^(?:what(?:'s| is)|show|list)\s+(?:in|inside)\s+(.+)$/i
  );
  if (listLocationMatch) {
    const subject = cleanupSubject(listLocationMatch[1]);
    return {
      intent: "list_location",
      subject: subject || normalizedQuery,
      confidence: 0.92,
      rawQuery: query,
      normalizedQuery,
    };
  }

  const countMatch = normalizedQuery.match(
    /^how many\s+(.+?)(?:\s+do\s+i\s+have|\s+are\s+there)?$/i
  );
  if (countMatch) {
    const subject = cleanupSubject(countMatch[1]);
    return {
      intent: "count_items",
      subject: subject || normalizedQuery,
      confidence: 0.93,
      rawQuery: query,
      normalizedQuery,
    };
  }

  const whereMatch = normalizedQuery.match(/^(?:where(?:'s| is)?|locate|find)\s+(.+)$/i);
  if (whereMatch) {
    const subject = cleanupSubject(whereMatch[1]);
    return {
      intent: "find_item",
      subject: subject || normalizedQuery,
      confidence: 0.9,
      rawQuery: query,
      normalizedQuery,
    };
  }

  const haveMatch = normalizedQuery.match(/^do\s+i\s+have\s+(.+)$/i);
  if (haveMatch) {
    const subject = cleanupSubject(haveMatch[1]);
    return {
      intent: "count_items",
      subject: subject || normalizedQuery,
      confidence: 0.82,
      rawQuery: query,
      normalizedQuery,
    };
  }

  return {
    intent: "find_item",
    subject: cleanupSubject(normalizedQuery) || normalizedQuery,
    confidence: 0.55,
    rawQuery: query,
    normalizedQuery,
  };
}

function scoreConfidence(
  parseConfidence: number,
  lexicalScore: number,
  semanticScore: number
): number {
  const lexicalNorm = Math.max(0, Math.min(1, lexicalScore / 5));
  const semanticNorm = Math.max(0, Math.min(1, (semanticScore + 1) / 2));
  return roundConfidence(parseConfidence * 0.4 + lexicalNorm * 0.4 + semanticNorm * 0.2);
}

async function itemDescriptionById(itemId: string, scope: InventoryScope): Promise<string | null> {
  const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
  const result = await pool.query<{ description: string | null }>(
    `
    SELECT description
    FROM items
    WHERE id = $1 AND ${itemScope.sql}
    LIMIT 1
    `,
    [itemId, ...itemScope.params]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0].description;
}

async function findItemIntent(
  parsed: ParsedInventoryIntent,
  scope: InventoryScope
): Promise<InventoryAssistantResponse> {
  const searched = await semanticItemSearch({
    scope,
    query: parsed.subject,
    mode: "hybrid",
    limit: 1,
    offset: 0,
  });

  if (searched.results.length === 0) {
    return {
      query: parsed.rawQuery,
      normalized_query: parsed.normalizedQuery,
      intent: parsed.intent,
      confidence: roundConfidence(parsed.confidence * 0.35),
      fallback: true,
      answer: `I couldn't find "${parsed.subject}" in your inventory.`,
      item: null,
      location_path: null,
      notes: "Try another keyword or check spelling.",
      match_count: 0,
      requires_confirmation: false,
    };
  }

  const top = searched.results[0];
  const notes =
    (await itemDescriptionById(top.id, scope)) || "No additional notes were saved for this item.";

  return {
    query: parsed.rawQuery,
    normalized_query: parsed.normalizedQuery,
    intent: parsed.intent,
    confidence: scoreConfidence(parsed.confidence, top.lexical_score, top.semantic_score),
    fallback: false,
    answer: `${top.name} is in ${top.location_path}.`,
    item: top.name,
    location_path: top.location_path,
    notes,
    match_count: 1,
    requires_confirmation: false,
  };
}

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

async function listLocationIntent(
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

async function countItemsIntent(
  parsed: ParsedInventoryIntent,
  scope: InventoryScope
): Promise<InventoryAssistantResponse> {
  const needle = `%${parsed.subject}%`;
  const itemScope = inventoryScopeSql(scope, "i.household_id", "i.owner_user_id", 2);

  const countResult = await pool.query<{ total_count: string }>(
    `
    SELECT COUNT(*)::text AS total_count
    FROM items i
    WHERE
      ${itemScope.sql} AND (
        i.name ILIKE $1 OR
        COALESCE(i.description, '') ILIKE $1 OR
        array_to_string(i.keywords, ' ') ILIKE $1
      )
    `,
    [needle, ...itemScope.params]
  );

  const totalCount = Number(countResult.rows[0]?.total_count ?? "0");
  const top = await semanticItemSearch({
    scope,
    query: parsed.subject,
    mode: "hybrid",
    limit: 1,
    offset: 0,
  });

  if (totalCount === 0) {
    return {
      query: parsed.rawQuery,
      normalized_query: parsed.normalizedQuery,
      intent: parsed.intent,
      confidence: roundConfidence(parsed.confidence * 0.4),
      fallback: true,
      answer: `I found no items matching "${parsed.subject}".`,
      item: null,
      location_path: null,
      notes: "Try a broader keyword.",
      match_count: 0,
      requires_confirmation: false,
    };
  }

  const topResult = top.results[0] ?? null;
  return {
    query: parsed.rawQuery,
    normalized_query: parsed.normalizedQuery,
    intent: parsed.intent,
    confidence: roundConfidence(parsed.confidence * 0.88),
    fallback: false,
    answer: topResult
      ? `I found ${totalCount} item(s) matching "${parsed.subject}". Top match is ${topResult.name} in ${topResult.location_path}.`
      : `I found ${totalCount} item(s) matching "${parsed.subject}".`,
    item: topResult ? topResult.name : null,
    location_path: topResult ? topResult.location_path : null,
    notes: "Count includes name, description, and keyword matches.",
    match_count: totalCount,
    requires_confirmation: false,
  };
}

function unsupportedActionIntent(parsed: ParsedInventoryIntent): InventoryAssistantResponse {
  return {
    query: parsed.rawQuery,
    normalized_query: parsed.normalizedQuery,
    intent: parsed.intent,
    confidence: parsed.confidence,
    fallback: true,
    answer:
      "I can help find items, list location contents, or count matches, but I can't make inventory changes from Siri yet.",
    item: null,
    location_path: null,
    notes: `Unsupported action request: ${parsed.subject}`,
    match_count: 0,
    requires_confirmation: true,
  };
}

export async function answerInventoryQuestion(
  query: string,
  scope: InventoryScope
): Promise<InventoryAssistantResponse> {
  const parsed = parseInventoryIntent(query);

  switch (parsed.intent) {
    case "find_item":
      return findItemIntent(parsed, scope);
    case "list_location":
      return listLocationIntent(parsed, scope);
    case "count_items":
      return countItemsIntent(parsed, scope);
    case "unsupported_action":
      return unsupportedActionIntent(parsed);
    default:
      return findItemIntent(parsed, scope);
  }
}
