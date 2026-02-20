import { Router } from "express";
import { pool } from "../db/pool";
import { ItemRow, LocationRow } from "../types";

type InventoryNode = LocationRow & {
  children: InventoryNode[];
  items: Array<{
    id: string;
    name: string;
    brand: string | null;
    description: string | null;
    keywords: string[];
    low_churn: boolean;
    image_url: string | null;
    location_id: string;
    created_at: string;
    updated_at: string;
  }>;
};

const inventoryRouter = Router();

inventoryRouter.get("/inventory/tree", async (_req, res) => {
  try {
    const [locationResult, itemResult] = await Promise.all([
      pool.query<LocationRow>("SELECT * FROM locations ORDER BY name ASC"),
      pool.query<ItemRow>("SELECT * FROM items ORDER BY name ASC"),
    ]);

    const nodesById = new Map<string, InventoryNode>();
    for (const row of locationResult.rows) {
      nodesById.set(row.id, {
        ...row,
        children: [],
        items: [],
      });
    }

    const roots: InventoryNode[] = [];
    for (const node of nodesById.values()) {
      if (node.parent_id && nodesById.has(node.parent_id)) {
        const parent = nodesById.get(node.parent_id);
        parent?.children.push(node);
      } else {
        roots.push(node);
      }
    }

    for (const item of itemResult.rows) {
      const location = nodesById.get(item.location_id);
      if (!location) {
        continue;
      }

      location.items.push({
        id: item.id,
        name: item.name,
        brand: item.brand,
        description: item.description,
        keywords: item.keywords,
        low_churn: item.low_churn,
        image_url: item.image_url,
        location_id: item.location_id,
        created_at: item.created_at,
        updated_at: item.updated_at,
      });
    }

    const sortRecursive = (node: InventoryNode) => {
      node.children.sort((a, b) => a.name.localeCompare(b.name));
      node.items.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of node.children) {
        sortRecursive(child);
      }
    };

    roots.sort((a, b) => a.name.localeCompare(b.name));
    for (const root of roots) {
      sortRecursive(root);
    }

    return res.status(200).json({
      roots,
      total_locations: locationResult.rows.length,
      total_items: itemResult.rows.length,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default inventoryRouter;
