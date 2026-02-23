import { InventoryScope, inventoryScopeSql } from "../auth/inventoryScope";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { isUuid } from "../utils";
import { resolveEmbeddingProvider, semanticQueryTerms } from "./embeddings";
import { pineconeIndex, pineconeScopeFilter, pineconeTopK } from "./pineconeClient";

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

type ScopedSearchRow = {
  id: string;
  name: string;
  image_url: string | null;
  description: string | null;
  keywords: string[];
  location_path: string;
};

type RankedRow = SemanticSearchRow & {
  token_overlap_score: number;
};

function computeTokenOverlapScore(row: ScopedSearchRow, queryTerms: string[]): number {
  if (queryTerms.length === 0) {
    return 0;
  }

  const text = `${row.name} ${row.description ?? ""} ${(row.keywords ?? []).join(" ")}`
    .toLowerCase()
    .trim();

  let count = 0;
  for (const term of queryTerms) {
    if (text.includes(term.toLowerCase())) {
      count += 1;
    }
  }
  return count;
}

function computeLexicalScore(row: ScopedSearchRow, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return 0;
  }

  let score = 0;
  if (row.name.toLowerCase().includes(needle)) {
    score += 3;
  }
  if ((row.description ?? "").toLowerCase().includes(needle)) {
    score += 1.5;
  }
  if ((row.keywords ?? []).join(" ").toLowerCase().includes(needle)) {
    score += 1;
  }
  return score;
}

function computeRankScore(
  mode: SemanticSearchMode,
  lexicalScore: number,
  semanticScore: number,
  tokenOverlapScore: number
): number {
  if (mode === "lexical") {
    return lexicalScore + tokenOverlapScore * 0.35;
  }
  if (mode === "semantic") {
    return semanticScore + tokenOverlapScore * 0.12;
  }
  return lexicalScore * 0.6 + semanticScore * 0.3 + tokenOverlapScore * 0.1;
}

function keepsResultByMode(
  mode: SemanticSearchMode,
  lexicalScore: number,
  semanticScore: number,
  tokenOverlapScore: number
): boolean {
  if (mode === "lexical") {
    return lexicalScore > 0 || tokenOverlapScore > 0;
  }
  if (mode === "semantic") {
    return semanticScore > 0 && (tokenOverlapScore > 0 || semanticScore >= 0.85);
  }
  return lexicalScore > 0 || semanticScore > 0 || tokenOverlapScore > 0;
}

function pruneSemanticTail(rows: RankedRow[], mode: SemanticSearchMode): RankedRow[] {
  if (mode !== "semantic") {
    return rows;
  }

  const hardFiltered = rows.filter((row) => row.score >= 0.35);
  if (hardFiltered.length === 0) {
    return [];
  }

  const topScore = Math.max(...hardFiltered.map((row) => row.score));
  const floor = Math.max(topScore * 0.72, 0.35);
  return hardFiltered.filter((row) => row.score >= floor);
}

function sortByRank(rows: RankedRow[]): RankedRow[] {
  return rows.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.lexical_score !== a.lexical_score) {
      return b.lexical_score - a.lexical_score;
    }
    if (b.semantic_score !== a.semantic_score) {
      return b.semantic_score - a.semantic_score;
    }
    if (a.name !== b.name) {
      return a.name.localeCompare(b.name);
    }
    return a.id.localeCompare(b.id);
  });
}

async function fetchScopedItemsByIds(scope: InventoryScope, ids: string[]): Promise<ScopedSearchRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const rootScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 2);
  const recursiveScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 2);
  const itemScope = inventoryScopeSql(scope, "i.household_id", "i.owner_user_id", 2);

  const result = await pool.query<ScopedSearchRow>(
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
    )
    SELECT
      i.id,
      i.name,
      i.image_url,
      i.description,
      i.keywords,
      lp.path AS location_path
    FROM items i
    JOIN location_paths lp ON lp.id = i.location_id
    WHERE i.id = ANY($1::uuid[]) AND ${itemScope.sql}
    `,
    [ids, ...rootScope.params]
  );

  return result.rows;
}

async function postgresSemanticItemSearch(params: {
  scope: InventoryScope;
  query: string;
  mode: SemanticSearchMode;
  limit: number;
  offset: number;
}): Promise<SemanticSearchResult> {
  const provider = resolveEmbeddingProvider();
  const queryEmbedding = await provider.embed(params.query);
  const needle = `%${params.query}%`;
  const queryTerms = semanticQueryTerms(params.query);

  const rootScope = inventoryScopeSql(params.scope, "household_id", "owner_user_id", 4);
  const recursiveScope = inventoryScopeSql(params.scope, "l.household_id", "l.owner_user_id", 4);
  const itemScope = inventoryScopeSql(params.scope, "i.household_id", "i.owner_user_id", 4);

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
            SELECT COUNT(*)::double precision
            FROM unnest($3::text[]) AS query_token
            WHERE
              lower(i.name) LIKE ('%' || query_token || '%') OR
              lower(COALESCE(i.description, '')) LIKE ('%' || query_token || '%') OR
              EXISTS (
                SELECT 1
                FROM unnest(COALESCE(i.keywords, ARRAY[]::text[])) AS keyword
                WHERE lower(keyword) LIKE ('%' || query_token || '%')
              )
          ),
          0.0
        ) AS token_overlap_score,
        COALESCE(
          (
            SELECT SUM(ie.embedding[idx] * ($1::double precision[])[idx])::double precision
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
        token_overlap_score,
        semantic_score,
        CASE
          WHEN $5 = 'lexical' THEN lexical_score + token_overlap_score * 0.35
          WHEN $5 = 'semantic' THEN semantic_score + token_overlap_score * 0.12
          ELSE lexical_score * 0.6 + semantic_score * 0.3 + token_overlap_score * 0.1
        END AS score
      FROM scored
      WHERE CASE
        WHEN $5 = 'lexical' THEN lexical_score > 0 OR token_overlap_score > 0
        WHEN $5 = 'semantic' THEN semantic_score > 0 AND (token_overlap_score > 0 OR semantic_score >= 0.85)
        ELSE lexical_score > 0 OR semantic_score > 0 OR token_overlap_score > 0
      END
    ),
    filtered AS (
      SELECT *, MAX(score) OVER () AS top_score
      FROM ranked
      WHERE CASE
        WHEN $5 = 'semantic' THEN score >= 0.35
        ELSE true
      END
    ),
    relevance_pruned AS (
      SELECT *
      FROM filtered
      WHERE CASE
        WHEN $5 = 'semantic' THEN score >= GREATEST(top_score * 0.72, 0.35)
        ELSE true
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
    FROM relevance_pruned
    ORDER BY score DESC, lexical_score DESC, semantic_score DESC, name ASC, id ASC
    LIMIT $6 OFFSET $7
    `,
    [queryEmbedding, needle, queryTerms, ...rootScope.params, params.mode, params.limit, params.offset]
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

async function pineconeSemanticItemSearch(params: {
  scope: InventoryScope;
  query: string;
  mode: SemanticSearchMode;
  limit: number;
  offset: number;
}): Promise<SemanticSearchResult> {
  const topK = pineconeTopK(params.limit, params.offset);
  const queryTerms = semanticQueryTerms(params.query);

  const searchResponse = await pineconeIndex().searchRecords({
    query: {
      inputs: { text: params.query },
      topK,
      filter: pineconeScopeFilter(params.scope),
    },
    rerank: env.pineconeRerankModel
      ? {
          model: env.pineconeRerankModel,
          topN: topK,
          rankFields: [env.pineconeTextField],
        }
      : undefined,
  });

  const hitRows = searchResponse.result?.hits ?? [];
  if (hitRows.length === 0) {
    return { total: 0, results: [] };
  }

  const uniqueIds: string[] = [];
  const semanticById = new Map<string, number>();

  for (const hit of hitRows) {
    const id = String(hit._id);
    if (!isUuid(id) || semanticById.has(id)) {
      continue;
    }
    semanticById.set(id, Number(hit._score ?? 0));
    uniqueIds.push(id);
  }

  if (uniqueIds.length === 0) {
    return { total: 0, results: [] };
  }

  const scopedRows = await fetchScopedItemsByIds(params.scope, uniqueIds);
  const scopedById = new Map(scopedRows.map((row) => [row.id, row]));

  const ranked: RankedRow[] = [];
  for (const id of uniqueIds) {
    const row = scopedById.get(id);
    if (!row) {
      continue;
    }

    const semanticScore = semanticById.get(id) ?? 0;
    const lexicalScore = computeLexicalScore(row, params.query);
    const tokenOverlapScore = computeTokenOverlapScore(row, queryTerms);

    if (!keepsResultByMode(params.mode, lexicalScore, semanticScore, tokenOverlapScore)) {
      continue;
    }

    ranked.push({
      id: row.id,
      name: row.name,
      image_url: row.image_url,
      location_path: row.location_path,
      lexical_score: lexicalScore,
      semantic_score: semanticScore,
      score: computeRankScore(params.mode, lexicalScore, semanticScore, tokenOverlapScore),
      token_overlap_score: tokenOverlapScore,
    });
  }

  const pruned = sortByRank(pruneSemanticTail(ranked, params.mode));
  const total = pruned.length;
  const paged = pruned.slice(params.offset, params.offset + params.limit);

  return {
    total,
    results: paged.map((row) => ({
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
  if (env.searchProvider === "pinecone") {
    return pineconeSemanticItemSearch(params);
  }
  return postgresSemanticItemSearch(params);
}
