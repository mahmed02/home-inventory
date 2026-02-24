import { InventoryScope, inventoryScopeSql } from "../auth/inventoryScope";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { isUuid } from "../utils";
import { semanticQueryTerms } from "./embeddings";
import { pineconeIndex, pineconeScopeFilter, pineconeTopK } from "./pineconeClient";

export type SemanticSearchMode = "hybrid" | "semantic" | "lexical";

export type SemanticSearchRow = {
  id: string;
  name: string;
  image_url: string | null;
  quantity: number | null;
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
  quantity: number | null;
  description: string | null;
  keywords: string[];
  location_path: string;
};

type RankedRow = SemanticSearchRow & {
  token_overlap_score: number;
};

const MAX_CACHEABLE_QUERY_LENGTH = 512;
const UNDEFINED_TABLE_ERROR = "42P01";

type SemanticCacheLookupParams = {
  scope: InventoryScope;
  query: string;
  mode: SemanticSearchMode;
  limit: number;
  offset: number;
};

type ParsedCacheKey = {
  scopeKey: string;
  normalizedQuery: string;
  mode: SemanticSearchMode;
  limit: number;
  offset: number;
};

type Queryable = Pick<typeof pool, "query">;

function semanticCacheScopeKey(scope: InventoryScope): string {
  if (scope.householdId) {
    return `household:${scope.householdId}`;
  }
  if (scope.ownerUserId) {
    return `owner:${scope.ownerUserId}`;
  }
  return "legacy:unscoped";
}

function normalizeCacheQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function getDbErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const candidate = error as { code?: unknown };
  if (typeof candidate.code !== "string") {
    return null;
  }
  return candidate.code;
}

function parseCacheKey(params: SemanticCacheLookupParams): ParsedCacheKey | null {
  if (!env.semanticCacheEnabled) {
    return null;
  }

  const normalizedQuery = normalizeCacheQuery(params.query);
  if (!normalizedQuery || normalizedQuery.length > MAX_CACHEABLE_QUERY_LENGTH) {
    return null;
  }

  return {
    scopeKey: semanticCacheScopeKey(params.scope),
    normalizedQuery,
    mode: params.mode,
    limit: params.limit,
    offset: params.offset,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function parseCachedSemanticResult(payload: unknown): SemanticSearchResult | null {
  if (!isRecord(payload)) {
    return null;
  }

  const total = payload.total;
  const results = payload.results;
  if (typeof total !== "number" || !Number.isFinite(total) || !Array.isArray(results)) {
    return null;
  }

  const parsedRows: SemanticSearchRow[] = [];
  for (const row of results) {
    if (!isRecord(row)) {
      return null;
    }

    const id = row.id;
    const name = row.name;
    const imageUrl = row.image_url;
    const quantity = row.quantity;
    const locationPath = row.location_path;
    const lexicalScore = row.lexical_score;
    const semanticScore = row.semantic_score;
    const score = row.score;

    const hasValidShape =
      typeof id === "string" &&
      typeof name === "string" &&
      (typeof imageUrl === "string" || imageUrl === null) &&
      (typeof quantity === "number" || quantity === null) &&
      typeof locationPath === "string" &&
      typeof lexicalScore === "number" &&
      typeof semanticScore === "number" &&
      typeof score === "number";

    if (!hasValidShape) {
      return null;
    }

    parsedRows.push({
      id,
      name,
      image_url: imageUrl,
      quantity,
      location_path: locationPath,
      lexical_score: lexicalScore,
      semantic_score: semanticScore,
      score,
    });
  }

  return {
    total,
    results: parsedRows,
  };
}

async function readSemanticSearchCache(
  params: SemanticCacheLookupParams,
  allowStale: boolean
): Promise<SemanticSearchResult | null> {
  const key = parseCacheKey(params);
  if (!key) {
    return null;
  }

  const freshnessColumn = allowStale ? "stale_until" : "fresh_until";
  const result = await pool.query<{ response_payload: unknown }>(
    `
    SELECT response_payload
    FROM semantic_search_cache
    WHERE
      scope_key = $1
      AND normalized_query = $2
      AND mode = $3
      AND limit_count = $4
      AND offset_count = $5
      AND ${freshnessColumn} > now()
    LIMIT 1
    `,
    [key.scopeKey, key.normalizedQuery, key.mode, key.limit, key.offset]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  return parseCachedSemanticResult(result.rows[0].response_payload);
}

async function writeSemanticSearchCache(
  params: SemanticCacheLookupParams,
  payload: SemanticSearchResult
): Promise<void> {
  const key = parseCacheKey(params);
  if (!key) {
    return;
  }

  await pool.query(
    `
    DELETE FROM semantic_search_cache
    WHERE stale_until <= now()
    `
  );

  await pool.query(
    `
    INSERT INTO semantic_search_cache(
      scope_key,
      normalized_query,
      mode,
      limit_count,
      offset_count,
      response_payload,
      fresh_until,
      stale_until
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6::jsonb,
      now() + ($7 * interval '1 second'),
      now() + ($8 * interval '1 second')
    )
    ON CONFLICT (scope_key, normalized_query, mode, limit_count, offset_count)
    DO UPDATE SET
      response_payload = EXCLUDED.response_payload,
      fresh_until = EXCLUDED.fresh_until,
      stale_until = EXCLUDED.stale_until,
      updated_at = now()
    `,
    [
      key.scopeKey,
      key.normalizedQuery,
      key.mode,
      key.limit,
      key.offset,
      JSON.stringify(payload),
      env.semanticCacheFreshSeconds,
      env.semanticCacheStaleIfErrorSeconds,
    ]
  );
}

async function deleteSemanticSearchCacheByScope(
  scope: InventoryScope,
  queryable: Queryable = pool
): Promise<void> {
  if (!env.semanticCacheEnabled) {
    return;
  }

  await queryable.query(
    `
    DELETE FROM semantic_search_cache
    WHERE scope_key = $1
    `,
    [semanticCacheScopeKey(scope)]
  );
}

async function safeReadSemanticSearchCache(
  params: SemanticCacheLookupParams,
  allowStale: boolean
): Promise<SemanticSearchResult | null> {
  try {
    return await readSemanticSearchCache(params, allowStale);
  } catch (error) {
    if (getDbErrorCode(error) === UNDEFINED_TABLE_ERROR) {
      return null;
    }
    console.error("semantic cache read failed", error);
    return null;
  }
}

async function safeWriteSemanticSearchCache(
  params: SemanticCacheLookupParams,
  payload: SemanticSearchResult
): Promise<void> {
  try {
    await writeSemanticSearchCache(params, payload);
  } catch (error) {
    if (getDbErrorCode(error) === UNDEFINED_TABLE_ERROR) {
      return;
    }
    console.error("semantic cache write failed", error);
  }
}

export async function invalidateSemanticSearchCacheForScope(
  scope: InventoryScope,
  queryable: Queryable = pool
): Promise<void> {
  try {
    await deleteSemanticSearchCacheByScope(scope, queryable);
  } catch (error) {
    if (getDbErrorCode(error) === UNDEFINED_TABLE_ERROR) {
      return;
    }
    console.error("semantic cache invalidation failed", error);
  }
}

function rowSemanticTerms(row: ScopedSearchRow): Set<string> {
  const source = `${row.name} ${row.description ?? ""} ${(row.keywords ?? []).join(" ")}`.trim();
  return new Set(semanticQueryTerms(source));
}

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

function computeMemorySemanticScore(row: ScopedSearchRow, queryTerms: string[]): number {
  if (queryTerms.length === 0) {
    return 0;
  }

  const rowTerms = rowSemanticTerms(row);
  if (rowTerms.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const term of queryTerms) {
    if (rowTerms.has(term)) {
      overlap += 1;
    }
  }

  if (overlap === 0) {
    return 0;
  }

  return overlap / Math.sqrt(queryTerms.length * rowTerms.size);
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
      i.quantity,
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

async function fetchScopedItems(scope: InventoryScope): Promise<ScopedSearchRow[]> {
  const rootScope = inventoryScopeSql(scope, "household_id", "owner_user_id", 1);
  const recursiveScope = inventoryScopeSql(scope, "l.household_id", "l.owner_user_id", 1);
  const itemScope = inventoryScopeSql(scope, "i.household_id", "i.owner_user_id", 1);

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
      i.quantity,
      i.description,
      i.keywords,
      lp.path AS location_path
    FROM items i
    JOIN location_paths lp ON lp.id = i.location_id
    WHERE ${itemScope.sql}
    ORDER BY i.name ASC, i.id ASC
    `,
    rootScope.params
  );

  return result.rows;
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
      quantity: row.quantity,
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
      quantity: row.quantity,
      location_path: row.location_path,
      lexical_score: row.lexical_score,
      semantic_score: row.semantic_score,
      score: row.score,
    })),
  };
}

async function memorySemanticItemSearch(params: {
  scope: InventoryScope;
  query: string;
  mode: SemanticSearchMode;
  limit: number;
  offset: number;
}): Promise<SemanticSearchResult> {
  const queryTerms = semanticQueryTerms(params.query);
  const scopedRows = await fetchScopedItems(params.scope);

  const ranked: RankedRow[] = [];
  for (const row of scopedRows) {
    const lexicalScore = computeLexicalScore(row, params.query);
    const tokenOverlapScore = computeTokenOverlapScore(row, queryTerms);
    const semanticScore = computeMemorySemanticScore(row, queryTerms);

    if (!keepsResultByMode(params.mode, lexicalScore, semanticScore, tokenOverlapScore)) {
      continue;
    }

    ranked.push({
      id: row.id,
      name: row.name,
      image_url: row.image_url,
      quantity: row.quantity,
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
      quantity: row.quantity,
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
    const freshCached = await safeReadSemanticSearchCache(params, false);
    if (freshCached) {
      return freshCached;
    }

    try {
      const liveResult = await pineconeSemanticItemSearch(params);
      await safeWriteSemanticSearchCache(params, liveResult);
      return liveResult;
    } catch (error) {
      console.error("pinecone semantic search failed; attempting fallback", error);

      const staleCached = await safeReadSemanticSearchCache(params, true);
      if (staleCached) {
        return staleCached;
      }

      return memorySemanticItemSearch(params);
    }
  }
  if (env.searchProvider === "memory") {
    return memorySemanticItemSearch(params);
  }

  const exhaustiveCheck: never = env.searchProvider;
  throw new Error(`Unsupported SEARCH_PROVIDER=${exhaustiveCheck}.`);
}
