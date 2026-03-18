import { InventoryScope, canWriteInventory, inventoryScopeSql } from "../auth/inventoryScope";
import { pool } from "../db/pool";
import { roundConfidence, scoreConfidence } from "./intentParser";
import { resolveItemCandidates } from "./itemResolver";
import {
  ambiguousItemResponse,
  itemNotFoundResponse,
  quantityConfirmationResponse,
  readOnlyQuantityResponse,
} from "./lookupResponses";
import {
  InventoryAssistantOptions,
  InventoryAssistantResponse,
  InventoryIntent,
  ParsedInventoryIntent,
  QuantityMutationOperation,
} from "./lookupTypes";

function normalizeIdempotencyKey(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  return normalized.slice(0, 120);
}

function idempotencyScopeKey(scope: InventoryScope): string {
  if (scope.householdId) {
    return `household:${scope.householdId}`;
  }
  if (scope.ownerUserId) {
    return `owner:${scope.ownerUserId}`;
  }
  return "legacy:unscoped";
}

function quantityRequestFingerprint(params: {
  intent: InventoryIntent;
  subject: string;
  operation: QuantityMutationOperation;
  amount: number;
  itemId: string;
}): string {
  return JSON.stringify({
    intent: params.intent,
    subject: params.subject.toLowerCase(),
    operation: params.operation,
    amount: params.amount,
    item_id: params.itemId,
  });
}

function responseFromPayload(value: unknown): InventoryAssistantResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const payload = value as Partial<InventoryAssistantResponse>;
  if (typeof payload.answer !== "string" || typeof payload.intent !== "string") {
    return null;
  }
  return payload as InventoryAssistantResponse;
}

export async function mutateItemQuantityIntent(
  parsed: ParsedInventoryIntent,
  scope: InventoryScope,
  operation: QuantityMutationOperation,
  options: InventoryAssistantOptions
): Promise<InventoryAssistantResponse> {
  if (!canWriteInventory(scope)) {
    return readOnlyQuantityResponse(parsed);
  }

  const resolution = await resolveItemCandidates({
    scope,
    subject: parsed.subject,
    limit: 3,
  });
  if (!resolution.top) {
    return itemNotFoundResponse(parsed, operation);
  }

  if (resolution.ambiguous) {
    return ambiguousItemResponse(
      parsed,
      resolution.candidates.map((row) => row.name),
      operation
    );
  }

  const top = resolution.top;
  const amount = parsed.amount ?? (operation === "set" ? 0 : 1);
  const allowQuantityMutations = options.allowQuantityMutations ?? true;
  if (!allowQuantityMutations) {
    return quantityConfirmationResponse(parsed, top.name, top.location_path, operation, amount);
  }

  const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scopeKey = idempotencyScopeKey(scope);
    const requestFingerprint = quantityRequestFingerprint({
      intent: parsed.intent,
      subject: parsed.subject,
      operation,
      amount,
      itemId: top.id,
    });
    let shouldPersistIdempotency = false;

    if (idempotencyKey) {
      await client.query(
        `
        DELETE FROM siri_idempotency_keys
        WHERE scope_key = $1
          AND expires_at <= now()
        `,
        [scopeKey]
      );

      const reserved = await client.query(
        `
        INSERT INTO siri_idempotency_keys(scope_key, idempotency_key, request_fingerprint)
        VALUES ($1, $2, $3)
        ON CONFLICT (scope_key, idempotency_key) DO NOTHING
        RETURNING id
        `,
        [scopeKey, idempotencyKey, requestFingerprint]
      );

      if (reserved.rowCount === 0) {
        const existing = await client.query<{
          request_fingerprint: string;
          response_payload: unknown;
        }>(
          `
          SELECT request_fingerprint, response_payload
          FROM siri_idempotency_keys
          WHERE scope_key = $1 AND idempotency_key = $2
          LIMIT 1
          FOR UPDATE
          `,
          [scopeKey, idempotencyKey]
        );

        if (existing.rowCount === 0) {
          await client.query("ROLLBACK");
          return {
            query: parsed.rawQuery,
            normalized_query: parsed.normalizedQuery,
            intent: parsed.intent,
            confidence: roundConfidence(parsed.confidence * 0.6),
            fallback: true,
            answer:
              "I couldn't secure this request safely. Please retry with a new idempotency key.",
            item: top.name,
            location_path: top.location_path,
            notes: "No write was applied.",
            match_count: 1,
            requires_confirmation: true,
            quantity_operation: operation,
          };
        }

        const existingRow = existing.rows[0];
        if (existingRow.request_fingerprint !== requestFingerprint) {
          await client.query("ROLLBACK");
          return {
            query: parsed.rawQuery,
            normalized_query: parsed.normalizedQuery,
            intent: parsed.intent,
            confidence: roundConfidence(parsed.confidence * 0.65),
            fallback: true,
            answer:
              "This idempotency key was already used for a different quantity change. Use a new key.",
            item: top.name,
            location_path: top.location_path,
            notes: "No write was applied.",
            match_count: 1,
            requires_confirmation: true,
            quantity_operation: operation,
          };
        }

        const existingResponse = responseFromPayload(existingRow.response_payload);
        if (existingResponse) {
          await client.query("COMMIT");
          return existingResponse;
        }

        await client.query("ROLLBACK");
        return {
          query: parsed.rawQuery,
          normalized_query: parsed.normalizedQuery,
          intent: parsed.intent,
          confidence: roundConfidence(parsed.confidence * 0.65),
          fallback: true,
          answer:
            "A matching quantity update is still processing. Retry shortly with the same key.",
          item: top.name,
          location_path: top.location_path,
          notes: "No additional write was applied.",
          match_count: 1,
          requires_confirmation: true,
          quantity_operation: operation,
        };
      }

      shouldPersistIdempotency = true;
    }

    async function commitWithResponse(
      response: InventoryAssistantResponse
    ): Promise<InventoryAssistantResponse> {
      if (idempotencyKey && shouldPersistIdempotency) {
        await client.query(
          `
          UPDATE siri_idempotency_keys
          SET response_payload = $1::jsonb
          WHERE scope_key = $2 AND idempotency_key = $3
          `,
          [JSON.stringify(response), scopeKey, idempotencyKey]
        );
      }
      await client.query("COMMIT");
      return response;
    }

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
      return commitWithResponse(itemNotFoundResponse(parsed, operation));
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
        return commitWithResponse({
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
        });
      }
    } else {
      if (amount > baseQuantity) {
        return commitWithResponse({
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
        });
      }
      nextQuantity = baseQuantity - amount;
    }

    const updateScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 3);
    await client.query(
      `
      UPDATE items
      SET quantity = $1
      WHERE id = $2 AND ${updateScope.sql}
      `,
      [nextQuantity, top.id, ...updateScope.params]
    );

    const actionVerb =
      operation === "set"
        ? "Set"
        : operation === "add"
          ? `Added ${amount} to`
          : `Removed ${amount} from`;

    return commitWithResponse({
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
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
