import { InventoryScope, canWriteInventory, inventoryScopeSql } from "../auth/inventoryScope";
import { pool } from "../db/pool";
import { semanticItemSearch } from "../search/semanticSearch";

export type InventoryIntent =
  | "find_item"
  | "list_location"
  | "count_items"
  | "get_item_quantity"
  | "set_item_quantity"
  | "add_item_quantity"
  | "remove_item_quantity"
  | "unsupported_action";

export type ParsedInventoryIntent = {
  intent: InventoryIntent;
  subject: string;
  confidence: number;
  rawQuery: string;
  normalizedQuery: string;
  amount: number | null;
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
  quantity?: number | null;
  previous_quantity?: number | null;
  quantity_operation?: "get" | "set" | "add" | "remove" | null;
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
    .replace(/^(is|are|was|were)\s+/i, "")
    .replace(/^(of|from|to)\s+/i, "")
    .replace(/^(the|a|an|my|our|any)\s+/i, "")
    .replace(/\s+(please|in inventory|in the inventory)$/i, "")
    .trim();
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInt(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export function parseInventoryIntent(query: string): ParsedInventoryIntent {
  const normalizedQuery = normalizePunctuation(query).toLowerCase();

  const setQuantityMatch =
    normalizedQuery.match(
      /^(?:set|update)\s+(?:the\s+)?(?:count|quantity)\s+(?:of\s+)?(.+?)\s+(?:to|=)\s*(\d+)$/i
    ) ||
    normalizedQuery.match(
      /^(?:set|update)\s+(.+?)\s+(?:count|quantity)\s+(?:to|=)\s*(\d+)$/i
    );
  if (setQuantityMatch) {
    const amount = parseNonNegativeInt(setQuantityMatch[2]);
    const subject = cleanupSubject(setQuantityMatch[1]);
    if (amount !== null && subject) {
      return {
        intent: "set_item_quantity",
        subject,
        confidence: 0.95,
        rawQuery: query,
        normalizedQuery,
        amount,
      };
    }
  }

  const addQuantityMatch = normalizedQuery.match(/^(?:add|increase)\s+(?:(\d+)\s+)?(.+)$/i);
  if (addQuantityMatch) {
    const explicitAmount = addQuantityMatch[1];
    const parsedAmount = parsePositiveInt(explicitAmount);
    if (explicitAmount && parsedAmount === null) {
      return {
        intent: "unsupported_action",
        subject: cleanupSubject(addQuantityMatch[2]) || normalizedQuery,
        confidence: 0.8,
        rawQuery: query,
        normalizedQuery,
        amount: null,
      };
    }
    const amount = parsedAmount ?? 1;
    const subject = cleanupSubject(addQuantityMatch[2]);
    if (subject) {
      return {
        intent: "add_item_quantity",
        subject,
        confidence: 0.88,
        rawQuery: query,
        normalizedQuery,
        amount,
      };
    }
  }

  const removeQuantityMatch = normalizedQuery.match(
    /^(?:remove|decrease|subtract)\s+(?:(\d+)\s+)?(.+)$/i
  );
  if (removeQuantityMatch) {
    const explicitAmount = removeQuantityMatch[1];
    const parsedAmount = parsePositiveInt(explicitAmount);
    if (explicitAmount && parsedAmount === null) {
      return {
        intent: "unsupported_action",
        subject: cleanupSubject(removeQuantityMatch[2]) || normalizedQuery,
        confidence: 0.8,
        rawQuery: query,
        normalizedQuery,
        amount: null,
      };
    }
    const amount = parsedAmount ?? 1;
    const subject = cleanupSubject(removeQuantityMatch[2]);
    if (subject) {
      return {
        intent: "remove_item_quantity",
        subject,
        confidence: 0.88,
        rawQuery: query,
        normalizedQuery,
        amount,
      };
    }
  }

  const getQuantityMatch =
    normalizedQuery.match(
      /^(?:get|show)\s+(?:the\s+)?(?:count|quantity)\s+(?:of\s+)?(.+)$/i
    ) ||
    normalizedQuery.match(
      /^(?:what(?:'s| is)\s+(?:the\s+)?(?:count|quantity)\s+(?:of\s+)?)(.+)$/i
    ) ||
    normalizedQuery.match(/^how many(?:\s+of)?\s+(?:my|our)\s+(.+?)(?:\s+do\s+i\s+have)?$/i);
  if (getQuantityMatch) {
    const subject = cleanupSubject(getQuantityMatch[1]);
    return {
      intent: "get_item_quantity",
      subject: subject || normalizedQuery,
      confidence: 0.9,
      rawQuery: query,
      normalizedQuery,
      amount: null,
    };
  }

  const unsupportedMatch = normalizedQuery.match(
    /^(move|delete|rename|update|edit)\s+(.+)$/i
  );
  if (unsupportedMatch) {
    const subject = cleanupSubject(unsupportedMatch[2]);
    return {
      intent: "unsupported_action",
      subject: subject || normalizedQuery,
      confidence: 0.96,
      rawQuery: query,
      normalizedQuery,
      amount: null,
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
      amount: null,
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
      amount: null,
    };
  }

  const whereMatch = normalizedQuery.match(
    /^(?:where\s+(?:is|are|was|were)|where's|where can i find|locate|find)\s+(.+)$/i
  );
  if (whereMatch) {
    const subject = cleanupSubject(whereMatch[1]);
    return {
      intent: "find_item",
      subject: subject || normalizedQuery,
      confidence: 0.9,
      rawQuery: query,
      normalizedQuery,
      amount: null,
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
      amount: null,
    };
  }

  return {
    intent: "find_item",
    subject: cleanupSubject(normalizedQuery) || normalizedQuery,
    confidence: 0.55,
    rawQuery: query,
    normalizedQuery,
    amount: null,
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

function hasAmbiguousTopMatch(
  results: Array<{ name: string; score: number }>
): boolean {
  if (results.length < 2) {
    return false;
  }
  const top = results[0];
  const next = results[1];
  if (top.name.toLowerCase() === next.name.toLowerCase()) {
    return false;
  }
  return Math.abs(top.score - next.score) <= 0.08;
}

async function quantityCandidates(parsed: ParsedInventoryIntent, scope: InventoryScope) {
  return semanticItemSearch({
    scope,
    query: parsed.subject,
    mode: "hybrid",
    limit: 3,
    offset: 0,
  });
}

function readOnlyQuantityResponse(parsed: ParsedInventoryIntent): InventoryAssistantResponse {
  return {
    query: parsed.rawQuery,
    normalized_query: parsed.normalizedQuery,
    intent: parsed.intent,
    confidence: parsed.confidence,
    fallback: true,
    answer: "You currently have read-only household access and cannot change quantities.",
    item: null,
    location_path: null,
    notes: "Ask a household owner for editor access to update counts.",
    match_count: 0,
    requires_confirmation: true,
    quantity_operation: null,
  };
}

function ambiguousQuantityResponse(
  parsed: ParsedInventoryIntent,
  names: string[]
): InventoryAssistantResponse {
  const shortlist = names.slice(0, 3).join(", ");
  return {
    query: parsed.rawQuery,
    normalized_query: parsed.normalizedQuery,
    intent: parsed.intent,
    confidence: roundConfidence(parsed.confidence * 0.5),
    fallback: true,
    answer: `I found multiple close matches for "${parsed.subject}". Please be more specific.`,
    item: null,
    location_path: null,
    notes: shortlist ? `Closest matches: ${shortlist}.` : "Multiple close matches found.",
    match_count: names.length,
    requires_confirmation: true,
    quantity_operation: null,
  };
}

async function getItemQuantityIntent(
  parsed: ParsedInventoryIntent,
  scope: InventoryScope
): Promise<InventoryAssistantResponse> {
  const searched = await quantityCandidates(parsed, scope);
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
      quantity_operation: "get",
    };
  }

  if (hasAmbiguousTopMatch(searched.results)) {
    return ambiguousQuantityResponse(
      parsed,
      searched.results.map((row) => row.name)
    );
  }

  const top = searched.results[0];
  const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
  const row = await pool.query<{ quantity: number | null }>(
    `
    SELECT quantity
    FROM items
    WHERE id = $1 AND ${itemScope.sql}
    LIMIT 1
    `,
    [top.id, ...itemScope.params]
  );

  if (row.rowCount === 0) {
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
      quantity_operation: "get",
    };
  }

  const quantity = row.rows[0].quantity ?? null;
  return {
    query: parsed.rawQuery,
    normalized_query: parsed.normalizedQuery,
    intent: parsed.intent,
    confidence: scoreConfidence(parsed.confidence, top.lexical_score, top.semantic_score),
    fallback: false,
    answer:
      quantity === null
        ? `${top.name} in ${top.location_path} does not have a quantity set yet.`
        : `${top.name} in ${top.location_path} has quantity ${quantity}.`,
    item: top.name,
    location_path: top.location_path,
    notes:
      quantity === null
        ? "Use set count to initialize tracking for this item."
        : "Quantity tracking is enabled for this item.",
    match_count: 1,
    requires_confirmation: false,
    quantity,
    previous_quantity: quantity,
    quantity_operation: "get",
  };
}

async function mutateItemQuantityIntent(
  parsed: ParsedInventoryIntent,
  scope: InventoryScope,
  operation: "set" | "add" | "remove"
): Promise<InventoryAssistantResponse> {
  if (!canWriteInventory(scope)) {
    return readOnlyQuantityResponse(parsed);
  }

  const searched = await quantityCandidates(parsed, scope);
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
      quantity_operation: operation,
    };
  }

  if (hasAmbiguousTopMatch(searched.results)) {
    return ambiguousQuantityResponse(
      parsed,
      searched.results.map((row) => row.name)
    );
  }

  const top = searched.results[0];
  const amount = parsed.amount ?? (operation === "set" ? 0 : 1);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const itemScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
    const current = await client.query<{ id: string; name: string; quantity: number | null }>(
      `
      SELECT id, name, quantity
      FROM items
      WHERE id = $1 AND ${itemScope.sql}
      FOR UPDATE
      `,
      [top.id, ...itemScope.params]
    );

    if (current.rowCount === 0) {
      await client.query("ROLLBACK");
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
        quantity_operation: operation,
      };
    }

    const currentRow = current.rows[0];
    const previousQuantity = currentRow.quantity ?? null;
    const baseQuantity = previousQuantity ?? 0;

    let nextQuantity = baseQuantity;
    if (operation === "set") {
      nextQuantity = amount;
    } else if (operation === "add") {
      nextQuantity = baseQuantity + amount;
      if (nextQuantity > 2_147_483_647) {
        await client.query("ROLLBACK");
        return {
          query: parsed.rawQuery,
          normalized_query: parsed.normalizedQuery,
          intent: parsed.intent,
          confidence: roundConfidence(parsed.confidence * 0.7),
          fallback: true,
          answer: `I can't set ${top.name} above the maximum supported quantity.`,
          item: top.name,
          location_path: top.location_path,
          notes: "Try a smaller increment.",
          match_count: 1,
          requires_confirmation: true,
          quantity: previousQuantity,
          previous_quantity: previousQuantity,
          quantity_operation: operation,
        };
      }
    } else {
      if (amount > baseQuantity) {
        await client.query("ROLLBACK");
        return {
          query: parsed.rawQuery,
          normalized_query: parsed.normalizedQuery,
          intent: parsed.intent,
          confidence: roundConfidence(parsed.confidence * 0.7),
          fallback: true,
          answer: `I can't remove ${amount} from ${top.name}; current quantity is ${baseQuantity}.`,
          item: top.name,
          location_path: top.location_path,
          notes: "Use a smaller remove amount or set the count directly.",
          match_count: 1,
          requires_confirmation: true,
          quantity: previousQuantity,
          previous_quantity: previousQuantity,
          quantity_operation: operation,
        };
      }
      nextQuantity = baseQuantity - amount;
    }

    await client.query(
      `
      UPDATE items
      SET quantity = $1
      WHERE id = $2 AND ${itemScope.sql}
      `,
      [nextQuantity, top.id, ...itemScope.params]
    );
    await client.query("COMMIT");

    const actionVerb =
      operation === "set" ? "Set" : operation === "add" ? `Added ${amount} to` : `Removed ${amount} from`;

    return {
      query: parsed.rawQuery,
      normalized_query: parsed.normalizedQuery,
      intent: parsed.intent,
      confidence: scoreConfidence(parsed.confidence, top.lexical_score, top.semantic_score),
      fallback: false,
      answer: `${actionVerb} ${top.name}. New quantity is ${nextQuantity}.`,
      item: top.name,
      location_path: top.location_path,
      notes: `Previous quantity: ${previousQuantity ?? 0}.`,
      match_count: 1,
      requires_confirmation: false,
      quantity: nextQuantity,
      previous_quantity: previousQuantity,
      quantity_operation: operation,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
      "I can find items, list location contents, count matches, and adjust item quantities, but I can't move or rename inventory from Siri yet.",
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
    case "get_item_quantity":
      return getItemQuantityIntent(parsed, scope);
    case "set_item_quantity":
      return mutateItemQuantityIntent(parsed, scope, "set");
    case "add_item_quantity":
      return mutateItemQuantityIntent(parsed, scope, "add");
    case "remove_item_quantity":
      return mutateItemQuantityIntent(parsed, scope, "remove");
    case "unsupported_action":
      return unsupportedActionIntent(parsed);
    default:
      return findItemIntent(parsed, scope);
  }
}
