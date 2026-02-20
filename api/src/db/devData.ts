import { PoolClient } from "pg";
import { pool } from "./pool";

async function insertLocation(
  client: PoolClient,
  params: { name: string; code: string; type: string; parentId: string | null }
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `
    INSERT INTO locations(name, code, type, parent_id)
    VALUES ($1, $2, $3, $4)
    RETURNING id
    `,
    [params.name, params.code, params.type, params.parentId]
  );
  return result.rows[0].id;
}

async function insertItem(
  client: PoolClient,
  params: {
    name: string;
    brand?: string;
    description?: string;
    keywords: string[];
    locationId: string;
  }
): Promise<void> {
  await client.query(
    `
    INSERT INTO items(name, brand, description, keywords, location_id)
    VALUES ($1, $2, $3, $4::text[], $5)
    `,
    [
      params.name,
      params.brand ?? null,
      params.description ?? null,
      params.keywords,
      params.locationId,
    ]
  );
}

export async function resetInventoryData(): Promise<void> {
  await pool.query("BEGIN");
  try {
    await pool.query("DELETE FROM items");
    await pool.query("DELETE FROM locations");
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  }
}

export async function seedInventoryData(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query("DELETE FROM items");
    await client.query("DELETE FROM locations");

    const houseId = await insertLocation(client, {
      name: "House",
      code: "H1",
      type: "house",
      parentId: null,
    });

    const garageId = await insertLocation(client, {
      name: "Garage",
      code: "G1",
      type: "room",
      parentId: houseId,
    });

    const garageShelf2Id = await insertLocation(client, {
      name: "Shelf 2",
      code: "G1-S2",
      type: "shelf",
      parentId: garageId,
    });

    const basementId = await insertLocation(client, {
      name: "Basement",
      code: "B1",
      type: "room",
      parentId: houseId,
    });

    const basementStorageId = await insertLocation(client, {
      name: "Storage Rack",
      code: "B1-R1",
      type: "shelf",
      parentId: basementId,
    });

    await insertItem(client, {
      name: "Ryobi Air Compressor",
      brand: "Ryobi",
      description: "Green, under tarp",
      keywords: ["compressor", "air", "green"],
      locationId: garageShelf2Id,
    });

    await insertItem(client, {
      name: "Tire Inflator",
      brand: "Milwaukee",
      description: "12V inflator",
      keywords: ["inflator", "tire", "air"],
      locationId: garageShelf2Id,
    });

    await insertItem(client, {
      name: "Winter Gloves",
      keywords: ["winter", "gloves", "snow"],
      locationId: basementStorageId,
    });

    await insertItem(client, {
      name: "Camping Lantern",
      keywords: ["camping", "lantern", "light"],
      locationId: basementStorageId,
    });

    await insertItem(client, {
      name: "Tool Belt",
      keywords: ["tool", "belt"],
      locationId: garageId,
    });

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
