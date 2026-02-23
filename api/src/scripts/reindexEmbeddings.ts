import { pool } from "../db/pool";
import { ReindexItemEmbeddingsMode, reindexItemEmbeddings } from "../search/reindexItemEmbeddings";
import { isUuid } from "../utils";

type CliOptions = {
  mode: ReindexItemEmbeddingsMode;
  batchSize: number;
  afterId: string | null;
  maxBatches: number | null;
};

function usage(): string {
  return [
    "Usage: npm --prefix ./api run embeddings:reindex -- [options]",
    "",
    "Options:",
    "  --mode <missing|all>      Reindex only missing rows (default) or all rows",
    "  --batch-size <number>     Batch size per transaction (default: 100, max: 1000)",
    "  --after-id <uuid>         Resume after this item id",
    "  --max-batches <number>    Stop after N batches (for chunked runs)",
    "  --help                    Show this message",
  ].join("\n");
}

function readArgValue(args: string[], index: number): { value: string; next: number } {
  const nextIndex = index + 1;
  if (nextIndex >= args.length) {
    throw new Error(`Missing value for ${args[index]}`);
  }
  return { value: args[nextIndex], next: nextIndex };
}

function parseIntArg(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`);
  }
  return Math.trunc(parsed);
}

function parseArgs(args: string[]): CliOptions {
  let mode: ReindexItemEmbeddingsMode = "missing";
  let batchSize = 100;
  let afterId: string | null = null;
  let maxBatches: number | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help") {
      console.log(usage());
      process.exit(0);
    }

    if (arg === "--mode") {
      const next = readArgValue(args, i);
      mode = next.value as ReindexItemEmbeddingsMode;
      i = next.next;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length) as ReindexItemEmbeddingsMode;
      continue;
    }

    if (arg === "--batch-size") {
      const next = readArgValue(args, i);
      batchSize = parseIntArg(next.value, "batch-size");
      i = next.next;
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      batchSize = parseIntArg(arg.slice("--batch-size=".length), "batch-size");
      continue;
    }

    if (arg === "--after-id") {
      const next = readArgValue(args, i);
      afterId = next.value;
      i = next.next;
      continue;
    }
    if (arg.startsWith("--after-id=")) {
      afterId = arg.slice("--after-id=".length);
      continue;
    }

    if (arg === "--max-batches") {
      const next = readArgValue(args, i);
      maxBatches = parseIntArg(next.value, "max-batches");
      i = next.next;
      continue;
    }
    if (arg.startsWith("--max-batches=")) {
      maxBatches = parseIntArg(arg.slice("--max-batches=".length), "max-batches");
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (mode !== "missing" && mode !== "all") {
    throw new Error("mode must be one of: missing, all");
  }

  if (afterId && !isUuid(afterId)) {
    throw new Error("after-id must be a UUID");
  }

  return {
    mode,
    batchSize,
    afterId,
    maxBatches,
  };
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const summary = await reindexItemEmbeddings({
    mode: options.mode,
    batchSize: options.batchSize,
    afterId: options.afterId,
    maxBatches: options.maxBatches,
    onBatch: (progress) => {
      console.log(
        JSON.stringify({
          event: "batch",
          batch: progress.batch,
          processed: progress.processed,
          total_processed: progress.totalProcessed,
          last_item_id: progress.lastItemId,
        })
      );
    },
  });

  console.log(
    JSON.stringify({
      event: summary.completed ? "done" : "stopped",
      mode: summary.mode,
      batch_size: summary.batchSize,
      batches: summary.batches,
      total_processed: summary.totalProcessed,
      last_item_id: summary.lastItemId,
      completed: summary.completed,
    })
  );
}

run()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error("Embedding reindex failed", error);
    await pool.end();
    process.exit(1);
  });
