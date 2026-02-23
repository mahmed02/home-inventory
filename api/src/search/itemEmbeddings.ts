import { PoolClient } from "pg";
import { pool } from "../db/pool";
import { ItemRow } from "../types";
import { resolveEmbeddingProvider } from "./embeddings";

type Queryable = Pick<PoolClient, "query">;

type ItemEmbeddingInput = Pick<
  ItemRow,
  "id" | "name" | "description" | "keywords" | "owner_user_id" | "household_id"
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

export async function upsertItemEmbedding(
  item: ItemEmbeddingInput,
  queryable: Queryable = pool
): Promise<void> {
  const provider = resolveEmbeddingProvider();
  const sourceText = itemEmbeddingSourceText(item);
  const embedding = await provider.embed(sourceText);

  await queryable.query(
    `
    INSERT INTO item_embeddings(
      item_id,
      owner_user_id,
      household_id,
      embedding,
      model,
      source_text
    )
    VALUES ($1, $2, $3, $4::double precision[], $5, $6)
    ON CONFLICT (item_id)
    DO UPDATE SET
      owner_user_id = EXCLUDED.owner_user_id,
      household_id = EXCLUDED.household_id,
      embedding = EXCLUDED.embedding,
      model = EXCLUDED.model,
      source_text = EXCLUDED.source_text
    `,
    [
      item.id,
      item.owner_user_id ?? null,
      item.household_id ?? null,
      embedding,
      provider.model,
      sourceText,
    ]
  );
}
