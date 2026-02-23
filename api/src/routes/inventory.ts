import { Router } from "express";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { deriveThumbnailUrlFromImageUrl } from "../media/thumbnails";
import { ItemRow, LocationRow } from "../types";
import { ownerScopeSql, requestOwnerUserId } from "../auth/ownerScope";

type InventoryNode = LocationRow & {
  children: InventoryNode[];
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    keywords: string[];
    image_url: string | null;
    thumbnail_url: string | null;
    location_id: string;
    created_at: string;
    updated_at: string;
  }>;
};

const inventoryRouter = Router();

inventoryRouter.get("/inventory/tree", async (req, res) => {
  const ownerUserId = requestOwnerUserId(req);

  try {
    const [locationResult, itemResult] = await Promise.all([
      pool.query<LocationRow>(
        `SELECT * FROM locations WHERE ${ownerScopeSql("owner_user_id", 1)} ORDER BY name ASC`,
        [ownerUserId]
      ),
      pool.query<ItemRow>(
        `SELECT * FROM items WHERE ${ownerScopeSql("owner_user_id", 1)} ORDER BY name ASC`,
        [ownerUserId]
      ),
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
        description: item.description,
        keywords: item.keywords,
        image_url: item.image_url,
        thumbnail_url: deriveThumbnailUrlFromImageUrl(item.image_url, env.s3Bucket, env.awsRegion),
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
