import fs from "node:fs/promises";
import path from "node:path";
import { PoolClient } from "pg";
import { pool } from "./pool";

export const defaultMigrationsDir = path.resolve(__dirname, "../../migrations");

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ version: string }>(
    "SELECT version FROM schema_migrations"
  );
  return new Set(result.rows.map((row) => row.version));
}

export async function applyPendingMigrations(
  migrationsDir = defaultMigrationsDir
): Promise<string[]> {
  const files = (await fs.readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  const appliedNow: string[] = [];

  try {
    await ensureMigrationsTable(client);
    const applied = await appliedVersions(client);

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }

      const fullPath = path.join(migrationsDir, file);
      const sql = await fs.readFile(fullPath, "utf8");

      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(version) VALUES ($1)",
        [file]
      );
      await client.query("COMMIT");

      appliedNow.push(file);
    }

    return appliedNow;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
