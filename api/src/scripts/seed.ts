import { seedInventoryData } from "../db/devData";
import { pool } from "../db/pool";

seedInventoryData()
  .then(async () => {
    console.log("Seed complete: inserted demo locations and items");
    await pool.end();
  })
  .catch(async (error) => {
    console.error("Seed failed", error);
    await pool.end();
    process.exit(1);
  });
