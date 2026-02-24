import { PoolClient } from "pg";
import { env } from "../config/env";
import { ItemRow } from "../types";
import { pineconeIndex, pineconeRecordFromItem } from "./pineconeClient";

type Queryable = Pick<PoolClient, "query">;

type ItemEmbeddingInput = Pick<
  ItemRow,
  "id" | "name" | "description" | "keywords" | "location_id" | "owner_user_id" | "household_id"
>;

function normalizeText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return value.trim();
}

export function itemEmbeddingSourceText(item: ItemEmbeddingInput): string {
  return [
    normalizeText(item.name),
    normalizeText(item.description),
    (item.keywords || [])
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0)
      .join(" "),
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

async function upsertPineconeItemEmbedding(item: ItemEmbeddingInput): Promise<void> {
  const sourceText = itemEmbeddingSourceText(item);
  const record = pineconeRecordFromItem(item, sourceText);
  await pineconeIndex().upsertRecords({
    records: [record],
  });
}

export async function upsertItemEmbedding(
  item: ItemEmbeddingInput,
  _queryable?: Queryable
): Promise<void> {
  void _queryable;
  if (env.searchProvider !== "pinecone") {
    return;
  }
  await upsertPineconeItemEmbedding(item);
}

export async function deleteItemEmbedding(itemId: string): Promise<void> {
  if (env.searchProvider !== "pinecone") {
    return;
  }
  await pineconeIndex().deleteOne({ id: itemId });
}
