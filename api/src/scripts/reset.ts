import { resetInventoryData } from "../db/devData";
import { pool } from "../db/pool";

resetInventoryData()
  .then(async () => {
    console.log("Database reset complete (items and locations cleared)");
    await pool.end();
  })
  .catch(async (error) => {
    console.error("Reset failed", error);
    await pool.end();
    process.exit(1);
  });
