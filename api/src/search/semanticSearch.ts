import { InventoryScope, inventoryScopeSql } from "../auth/inventoryScope";
import { pool } from "../db/pool";
import { resolveEmbeddingProvider } from "./embeddings";

export type SemanticSearchMode = "hybrid" | "semantic" | "lexical";

export type SemanticSearchRow = {
  id: string;
  name: string;
  image_url: string | null;
  location_path: string;
  lexical_score: number;
  semantic_score: number;
  score: number;
};

export type SemanticSearchResult = {
  total: number;
  results: SemanticSearchRow[];
};

export function isSemanticSearchMode(value: string): value is SemanticSearchMode {
  return value === "hybrid" || value === "semantic" || value === "lexical";
}

export async function semanticItemSearch(params: {
  scope: InventoryScope;
  query: string;
  mode: SemanticSearchMode;
  limit: number;
  offset: number;
}): Promise<SemanticSearchResult> {
  const provider = resolveEmbeddingProvider();
  const queryEmbedding = await provider.embed(params.query);
  const needle = `%${params.query}%`;

  const rootScope = inventoryScopeSql(params.scope, "household_id", "owner_user_id", 3);
  const recursiveScope = inventoryScopeSql(params.scope, "l.household_id", "l.owner_user_id", 3);
  const itemScope = inventoryScopeSql(params.scope, "i.household_id", "i.owner_user_id", 3);

  const result = await pool.query<
    SemanticSearchRow & {
      total_count: string;
    }
  >(
    `
    WITH RECURSIVE location_paths AS (
      SELECT id, parent_id, name, name::text AS path
      FROM locations
      WHERE parent_id IS NULL AND ${rootScope.sql}
      UNION ALL
      SELECT l.id, l.parent_id, l.name, lp.path || ' > ' || l.name
      FROM locations l
      JOIN location_paths lp ON l.parent_id = lp.id
      WHERE ${recursiveScope.sql}
    ),
    scored AS (
      SELECT
        i.id,
        i.name,
        i.image_url,
        lp.path AS location_path,
        (
          CASE WHEN i.name ILIKE $2 THEN 3.0 ELSE 0.0 END +
          CASE WHEN COALESCE(i.description, '') ILIKE $2 THEN 1.5 ELSE 0.0 END +
          CASE WHEN array_to_string(i.keywords, ' ') ILIKE $2 THEN 1.0 ELSE 0.0 END
        )::double precision AS lexical_score,
        COALESCE(
          (
            SELECT SUM(ie.embedding[idx] * ($1::double precision[])[idx])
            FROM generate_subscripts(ie.embedding, 1) AS idx
            WHERE ($1::double precision[])[idx] IS NOT NULL
          ),
          0.0
        )::double precision AS semantic_score
      FROM items i
      JOIN location_paths lp ON lp.id = i.location_id
      LEFT JOIN item_embeddings ie ON ie.item_id = i.id
      WHERE ${itemScope.sql}
    ),
    ranked AS (
      SELECT
        id,
        name,
        image_url,
        location_path,
        lexical_score,
        semantic_score,
        CASE
          WHEN $4 = 'lexical' THEN lexical_score
          WHEN $4 = 'semantic' THEN semantic_score
          ELSE lexical_score * 0.65 + semantic_score * 0.35
        END AS score
      FROM scored
      WHERE CASE
        WHEN $4 = 'lexical' THEN lexical_score > 0
        WHEN $4 = 'semantic' THEN semantic_score > 0
        ELSE lexical_score > 0 OR semantic_score > 0
      END
    )
    SELECT
      id,
      name,
      image_url,
      location_path,
      lexical_score,
      semantic_score,
      score,
      COUNT(*) OVER()::text AS total_count
    FROM ranked
    ORDER BY score DESC, lexical_score DESC, semantic_score DESC, name ASC, id ASC
    LIMIT $5 OFFSET $6
    `,
    [queryEmbedding, needle, ...rootScope.params, params.mode, params.limit, params.offset]
  );

  return {
    total: Number(result.rows[0]?.total_count ?? "0"),
    results: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      image_url: row.image_url,
      location_path: row.location_path,
      lexical_score: row.lexical_score,
      semantic_score: row.semantic_score,
      score: row.score,
    })),
  };
}
