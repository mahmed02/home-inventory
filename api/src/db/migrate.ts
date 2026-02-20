import { applyPendingMigrations } from "./migrations";
import { pool } from "./pool";

async function run(): Promise<void> {
  const applied = await applyPendingMigrations();
  for (const migration of applied) {
    console.log(`Applied migration: ${migration}`);
  }
}

run()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error("Migration failed", error);
    await pool.end();
    process.exit(1);
  });
