import { Pinecone } from "@pinecone-database/pinecone";
import { InventoryScope } from "../auth/inventoryScope";
import { env } from "../config/env";
import { ItemRow } from "../types";

export const PINECONE_LEGACY_OWNER_TOKEN = "__legacy__";
export const PINECONE_NO_HOUSEHOLD_TOKEN = "__none__";

let cachedClient: Pinecone | null = null;
let cachedIndex: ReturnType<Pinecone["index"]> | null = null;

function assertPineconeConfigured(): void {
  if (!env.pineconeApiKey || !env.pineconeIndexName) {
    throw new Error(
      "Pinecone search provider requires PINECONE_API_KEY and PINECONE_INDEX_NAME to be configured."
    );
  }
}

function pineconeOwnerToken(ownerUserId: string | null | undefined): string {
  return ownerUserId ?? PINECONE_LEGACY_OWNER_TOKEN;
}

function pineconeHouseholdToken(householdId: string | null | undefined): string {
  return householdId ?? PINECONE_NO_HOUSEHOLD_TOKEN;
}

function normalizeKeywords(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function createPineconeClient(): Pinecone {
  if (cachedClient) {
    return cachedClient;
  }

  assertPineconeConfigured();
  cachedClient = new Pinecone({ apiKey: env.pineconeApiKey });
  return cachedClient;
}

export function pineconeIndex() {
  if (cachedIndex) {
    return cachedIndex;
  }

  const client = createPineconeClient();
  if (env.pineconeIndexHost) {
    cachedIndex = client.index({
      host: env.pineconeIndexHost,
      namespace: env.pineconeNamespace,
    });
  } else {
    cachedIndex = client.index({
      name: env.pineconeIndexName,
      namespace: env.pineconeNamespace,
    });
  }
  return cachedIndex;
}

export function pineconeScopeFilter(scope: InventoryScope): object {
  if (scope.householdId) {
    return {
      household_id: { $eq: scope.householdId },
    };
  }

  return {
    $and: [
      { household_id: { $eq: PINECONE_NO_HOUSEHOLD_TOKEN } },
      { owner_user_id: { $eq: pineconeOwnerToken(scope.ownerUserId) } },
    ],
  };
}

export function pineconeTopK(limit: number, offset: number): number {
  return Math.min(Math.max(limit + offset + 50, 64), 512);
}

export function pineconeRecordFromItem(
  item: Pick<
    ItemRow,
    "id" | "name" | "description" | "keywords" | "location_id" | "owner_user_id" | "household_id"
  >,
  sourceText: string
): Record<string, string | number | boolean | string[]> {
  const record: Record<string, string | number | boolean | string[]> = {
    id: item.id,
    item_id: item.id,
    item_name: item.name,
    description: item.description ?? "",
    keywords: normalizeKeywords(item.keywords),
    location_id: item.location_id,
    owner_user_id: pineconeOwnerToken(item.owner_user_id),
    household_id: pineconeHouseholdToken(item.household_id),
  };

  record[env.pineconeTextField] = sourceText.trim().length > 0 ? sourceText : item.name;
  return record;
}
