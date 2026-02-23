import { pool } from "../db/pool";
import { ItemRow } from "../types";
import { isUuid } from "../utils";
import { upsertItemEmbedding } from "./itemEmbeddings";

export type ReindexItemEmbeddingsMode = "missing" | "all";

export type ReindexItemEmbeddingsOptions = {
  mode?: ReindexItemEmbeddingsMode;
  batchSize?: number;
  afterId?: string | null;
  maxBatches?: number | null;
  onBatch?: (progress: ReindexItemEmbeddingsBatchProgress) => void | Promise<void>;
};

export type ReindexItemEmbeddingsBatchProgress = {
  batch: number;
  processed: number;
  totalProcessed: number;
  lastItemId: string;
};

export type ReindexItemEmbeddingsSummary = {
  mode: ReindexItemEmbeddingsMode;
  batchSize: number;
  batches: number;
  totalProcessed: number;
  lastItemId: string | null;
  completed: boolean;
};

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1000;

function normalizeMode(mode: ReindexItemEmbeddingsMode | undefined): ReindexItemEmbeddingsMode {
  return mode ?? "missing";
}

function normalizeBatchSize(batchSize: number | undefined): number {
  if (!Number.isFinite(batchSize)) {
    return DEFAULT_BATCH_SIZE;
  }

  const normalized = Math.trunc(batchSize as number);
  if (normalized < 1) {
    throw new Error("batchSize must be at least 1");
  }

  return Math.min(normalized, MAX_BATCH_SIZE);
}

function normalizeAfterId(afterId: string | null | undefined): string | null {
  if (!afterId) {
    return null;
  }

  if (!isUuid(afterId)) {
    throw new Error("afterId must be a UUID");
  }

  return afterId;
}

function normalizeMaxBatches(maxBatches: number | null | undefined): number | null {
  if (maxBatches === null || maxBatches === undefined) {
    return null;
  }

  if (!Number.isFinite(maxBatches)) {
    throw new Error("maxBatches must be a finite number");
  }

  const normalized = Math.trunc(maxBatches);
  if (normalized < 1) {
    throw new Error("maxBatches must be at least 1");
  }

  return normalized;
}

async function loadBatch(
  _mode: ReindexItemEmbeddingsMode,
  afterId: string | null,
  batchSize: number,
  queryable: Pick<typeof pool, "query">
): Promise<ItemRow[]> {
  const result = await queryable.query<ItemRow>(
    `
    SELECT i.*
    FROM items i
    WHERE ($1::uuid IS NULL OR i.id > $1::uuid)
    ORDER BY i.id ASC
    LIMIT $2
    `,
    [afterId, batchSize]
  );
  return result.rows;
}

export async function reindexItemEmbeddings(
  options: ReindexItemEmbeddingsOptions = {}
): Promise<ReindexItemEmbeddingsSummary> {
  const mode = normalizeMode(options.mode);
  const batchSize = normalizeBatchSize(options.batchSize);
  const maxBatches = normalizeMaxBatches(options.maxBatches);

  let lastItemId = normalizeAfterId(options.afterId);
  let batches = 0;
  let totalProcessed = 0;

  while (true) {
    if (maxBatches !== null && batches >= maxBatches) {
      return {
        mode,
        batchSize,
        batches,
        totalProcessed,
        lastItemId,
        completed: false,
      };
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await loadBatch(mode, lastItemId, batchSize, client);

      if (rows.length === 0) {
        await client.query("COMMIT");
        return {
          mode,
          batchSize,
          batches,
          totalProcessed,
          lastItemId,
          completed: true,
        };
      }

      for (const item of rows) {
        await upsertItemEmbedding(item, client);
      }

      lastItemId = rows[rows.length - 1].id;
      batches += 1;
      totalProcessed += rows.length;

      await client.query("COMMIT");

      if (options.onBatch) {
        await options.onBatch({
          batch: batches,
          processed: rows.length,
          totalProcessed,
          lastItemId,
        });
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
