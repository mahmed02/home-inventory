CREATE TABLE IF NOT EXISTS semantic_search_cache (
  id bigserial PRIMARY KEY,
  scope_key text NOT NULL,
  normalized_query text NOT NULL,
  mode text NOT NULL,
  limit_count integer NOT NULL,
  offset_count integer NOT NULL,
  response_payload jsonb NOT NULL,
  fresh_until timestamptz NOT NULL,
  stale_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_semantic_search_cache_mode
    CHECK (mode IN ('hybrid', 'semantic', 'lexical')),
  CONSTRAINT ck_semantic_search_cache_limit_count
    CHECK (limit_count >= 1 AND limit_count <= 100),
  CONSTRAINT ck_semantic_search_cache_offset_count
    CHECK (offset_count >= 0),
  CONSTRAINT ck_semantic_search_cache_expiry_window
    CHECK (stale_until >= fresh_until)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_semantic_search_cache_lookup
ON semantic_search_cache(scope_key, normalized_query, mode, limit_count, offset_count);

CREATE INDEX IF NOT EXISTS idx_semantic_search_cache_stale_until
ON semantic_search_cache(stale_until);
