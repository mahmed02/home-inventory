import { roundConfidence } from "./intentParser";
import {
  InventoryAssistantResponse,
  ParsedInventoryIntent,
  QuantityMutationOperation,
} from "./lookupTypes";

export function itemNotFoundResponse(
  parsed: ParsedInventoryIntent,
  quantityOperation: InventoryAssistantResponse["quantity_operation"] = null
): InventoryAssistantResponse {
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
    quantity_operation: quantityOperation,
  };
}

export function ambiguousItemResponse(
  parsed: ParsedInventoryIntent,
  names: string[],
  quantityOperation: InventoryAssistantResponse["quantity_operation"] = null
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
    quantity_operation: quantityOperation,
  };
}

export function readOnlyQuantityResponse(
  parsed: ParsedInventoryIntent
): InventoryAssistantResponse {
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

export function quantityConfirmationResponse(
  parsed: ParsedInventoryIntent,
  itemName: string,
  locationPath: string,
  operation: QuantityMutationOperation,
  amount: number
): InventoryAssistantResponse {
  const actionText =
    operation === "set"
      ? `set ${itemName} to ${amount}`
      : operation === "add"
        ? `add ${amount} to ${itemName}`
        : `remove ${amount} from ${itemName}`;

  return {
    query: parsed.rawQuery,
    normalized_query: parsed.normalizedQuery,
    intent: parsed.intent,
    confidence: roundConfidence(parsed.confidence * 0.9),
    fallback: false,
    answer: `Confirmation required. I can ${actionText}. Re-run this request with confirm=true to apply.`,
    item: itemName,
    location_path: locationPath,
    notes: "Use query parameter confirm=true and an idempotency key to avoid duplicate writes.",
    match_count: 1,
    requires_confirmation: true,
    quantity_operation: operation,
  };
}

export function unsupportedActionResponse(
  parsed: ParsedInventoryIntent
): InventoryAssistantResponse {
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
