import { InventoryScope, inventoryScopeSql } from "../auth/inventoryScope";
import { pool } from "../db/pool";
import { roundConfidence, scoreConfidence } from "./intentParser";
import { ambiguousItemResponse, itemNotFoundResponse } from "./lookupResponses";
import { resolveReadItemLookup, resolveSingleReadItem } from "./readItemResolver";
import { InventoryAssistantResponse, ParsedInventoryIntent } from "./lookupTypes";

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

export async function findItemIntent(
  parsed: ParsedInventoryIntent,
  scope: InventoryScope
): Promise<InventoryAssistantResponse> {
  const lookup = await resolveReadItemLookup({
    scope,
    subject: parsed.subject,
    limit: 3,
  });
  const resolution = resolveSingleReadItem(lookup);

  if (resolution.status === "none") {
    return itemNotFoundResponse(parsed);
  }

  if (resolution.status === "ambiguous") {
    return ambiguousItemResponse(parsed, resolution.names);
  }

  const top = resolution.item;

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

export async function getItemQuantityIntent(
  parsed: ParsedInventoryIntent,
  scope: InventoryScope
): Promise<InventoryAssistantResponse> {
  const lookup = await resolveReadItemLookup({
    scope,
    subject: parsed.subject,
    limit: 3,
  });
  const resolution = resolveSingleReadItem(lookup);

  if (resolution.status === "none") {
    return itemNotFoundResponse(parsed, "get");
  }

  if (resolution.status === "ambiguous") {
    return ambiguousItemResponse(parsed, resolution.names, "get");
  }

  const top = resolution.item;
  const quantity = top.quantity ?? null;
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

export async function checkItemExistenceIntent(
  parsed: ParsedInventoryIntent,
  scope: InventoryScope
): Promise<InventoryAssistantResponse> {
  const lookup = await resolveReadItemLookup({
    scope,
    subject: parsed.subject,
    limit: 10,
  });

  if (!lookup.has_matches || !lookup.top) {
    return {
      query: parsed.rawQuery,
      normalized_query: parsed.normalizedQuery,
      intent: parsed.intent,
      confidence: roundConfidence(parsed.confidence * 0.45),
      fallback: true,
      answer: `No, I couldn't find "${parsed.subject}" in your inventory.`,
      item: null,
      location_path: null,
      notes: "Try a different name or a broader keyword.",
      match_count: 0,
      requires_confirmation: false,
    };
  }

  const top = lookup.top;
  const quantityText =
    top.quantity === null || top.quantity === undefined ? "" : ` Quantity: ${top.quantity}.`;
  const matchText =
    lookup.match_count > 1 ? ` I found ${lookup.match_count} matching item(s).` : "";

  return {
    query: parsed.rawQuery,
    normalized_query: parsed.normalizedQuery,
    intent: parsed.intent,
    confidence: scoreConfidence(parsed.confidence, top.lexical_score, top.semantic_score),
    fallback: false,
    answer: `Yes, ${top.name} is in ${top.location_path}.${quantityText}${matchText}`.trim(),
    item: top.name,
    location_path: top.location_path,
    notes:
      lookup.match_count > 1
        ? "Existence is based on the current item lookup matcher and may include multiple related items."
        : "Existence is based on the current item lookup matcher.",
    match_count: lookup.match_count,
    requires_confirmation: false,
    quantity: top.quantity ?? null,
  };
}

export async function countItemsIntent(
  parsed: ParsedInventoryIntent,
  scope: InventoryScope
): Promise<InventoryAssistantResponse> {
  const lookup = await resolveReadItemLookup({
    scope,
    subject: parsed.subject,
    limit: 10,
  });

  if (!lookup.has_matches) {
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

  const topResult = lookup.top;
  return {
    query: parsed.rawQuery,
    normalized_query: parsed.normalizedQuery,
    intent: parsed.intent,
    confidence: roundConfidence(parsed.confidence * 0.88),
    fallback: false,
    answer: topResult
      ? `I found ${lookup.match_count} item(s) matching "${parsed.subject}". Top match is ${topResult.name} in ${topResult.location_path}.`
      : `I found ${lookup.match_count} item(s) matching "${parsed.subject}".`,
    item: topResult ? topResult.name : null,
    location_path: topResult ? topResult.location_path : null,
    notes: "Count is based on matching item records, not summed quantity.",
    match_count: lookup.match_count,
    requires_confirmation: false,
  };
}
