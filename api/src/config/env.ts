import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

const projectEnvPath = path.resolve(__dirname, "../../.env");
const cwdEnvPath = path.resolve(process.cwd(), ".env");

if (fs.existsSync(projectEnvPath)) {
  dotenv.config({ path: projectEnvPath });
} else {
  dotenv.config({ path: cwdEnvPath });
}

const port = Number(process.env.PORT ?? "4000");
const databaseUrl = process.env.DATABASE_URL;
const appBaseUrl = process.env.APP_BASE_URL ?? `http://localhost:${port}`;
const awsRegion = process.env.AWS_REGION ?? "";
const s3Bucket = process.env.S3_BUCKET ?? "";
const basicAuthUser = process.env.BASIC_AUTH_USER ?? "";
const basicAuthPass = process.env.BASIC_AUTH_PASS ?? "";
const sessionTtlHoursRaw = Number(process.env.SESSION_TTL_HOURS ?? "720");
const searchProviderRaw = (process.env.SEARCH_PROVIDER ?? "pinecone").trim().toLowerCase();
const siriRequireMutationConfirmationRaw = (
  process.env.SIRI_REQUIRE_MUTATION_CONFIRMATION ?? "true"
)
  .trim()
  .toLowerCase();
const semanticCacheEnabledRaw = (process.env.SEMANTIC_CACHE_ENABLED ?? "true").trim().toLowerCase();
const semanticCacheFreshSecondsRaw = Number(process.env.SEMANTIC_CACHE_FRESH_SECONDS ?? "300");
const semanticCacheStaleIfErrorSecondsRaw = Number(
  process.env.SEMANTIC_CACHE_STALE_IF_ERROR_SECONDS ?? "86400"
);
const corsAllowOrigins = (process.env.CORS_ALLOW_ORIGINS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
const pineconeApiKey = process.env.PINECONE_API_KEY ?? "";
const pineconeIndexName = process.env.PINECONE_INDEX_NAME ?? "";
const pineconeIndexHost = process.env.PINECONE_INDEX_HOST ?? "";
const pineconeNamespace = process.env.PINECONE_NAMESPACE ?? "home-inventory";
const pineconeTextField = process.env.PINECONE_TEXT_FIELD ?? "chunk_text";
const pineconeRerankModel = process.env.PINECONE_RERANK_MODEL ?? "";

export function resolveEnableDevRoutes(): boolean {
  if (process.env.ENABLE_DEV_ROUTES === "true") {
    return true;
  }
  if (process.env.ENABLE_DEV_ROUTES === "false") {
    return false;
  }
  return false;
}

export function resolveRequireAuth(): boolean {
  if (process.env.REQUIRE_AUTH === "true") {
    return true;
  }
  if (process.env.REQUIRE_AUTH === "false") {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

export function resolveRequireUserAccounts(): boolean {
  if (process.env.REQUIRE_USER_ACCOUNTS === "true") {
    return true;
  }
  if (process.env.REQUIRE_USER_ACCOUNTS === "false") {
    return false;
  }
  return false;
}

export type SearchProvider = "pinecone" | "memory";

export function resolveSearchProvider(): SearchProvider {
  if (searchProviderRaw === "pinecone" || searchProviderRaw === "memory") {
    return searchProviderRaw;
  }
  throw new Error("SEARCH_PROVIDER must be set to 'pinecone' or 'memory'.");
}

function resolveSiriRequireMutationConfirmation(): boolean {
  if (siriRequireMutationConfirmationRaw === "true") {
    return true;
  }
  if (siriRequireMutationConfirmationRaw === "false") {
    return false;
  }
  throw new Error("SIRI_REQUIRE_MUTATION_CONFIRMATION must be true or false when set.");
}

function resolveSemanticCacheEnabled(): boolean {
  if (semanticCacheEnabledRaw === "true") {
    return true;
  }
  if (semanticCacheEnabledRaw === "false") {
    return false;
  }
  throw new Error("SEMANTIC_CACHE_ENABLED must be true or false when set.");
}

function resolvePositiveSeconds(
  rawValue: number,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  if (!Number.isFinite(rawValue)) {
    return fallback;
  }
  const normalized = Math.trunc(rawValue);
  if (normalized < min || normalized > max) {
    throw new Error(`${name} must be between ${min} and ${max} seconds.`);
  }
  return normalized;
}

const enableDevRoutes = resolveEnableDevRoutes();
const requireAuth = resolveRequireAuth();
const requireUserAccounts = resolveRequireUserAccounts();
const searchProvider = resolveSearchProvider();
const siriRequireMutationConfirmation = resolveSiriRequireMutationConfirmation();
const semanticCacheEnabled = resolveSemanticCacheEnabled();
const semanticCacheFreshSeconds = resolvePositiveSeconds(
  semanticCacheFreshSecondsRaw,
  "SEMANTIC_CACHE_FRESH_SECONDS",
  300,
  1,
  7 * 24 * 60 * 60
);
const semanticCacheStaleIfErrorSeconds = resolvePositiveSeconds(
  semanticCacheStaleIfErrorSecondsRaw,
  "SEMANTIC_CACHE_STALE_IF_ERROR_SECONDS",
  86400,
  semanticCacheFreshSeconds,
  30 * 24 * 60 * 60
);
const sessionTtlHours = Number.isFinite(sessionTtlHoursRaw)
  ? Math.min(Math.max(Math.trunc(sessionTtlHoursRaw), 1), 24 * 365)
  : 720;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

if (requireAuth && (!basicAuthUser || !basicAuthPass)) {
  throw new Error("BASIC_AUTH_USER and BASIC_AUTH_PASS are required when REQUIRE_AUTH=true");
}

if (requireAuth && requireUserAccounts) {
  throw new Error(
    "REQUIRE_AUTH and REQUIRE_USER_ACCOUNTS cannot both be true on the app; use edge basic auth instead."
  );
}

if (searchProvider === "pinecone" && (!pineconeApiKey || !pineconeIndexName)) {
  throw new Error(
    "PINECONE_API_KEY and PINECONE_INDEX_NAME are required when SEARCH_PROVIDER=pinecone"
  );
}

export const env = {
  port,
  databaseUrl,
  enableDevRoutes,
  requireAuth,
  requireUserAccounts,
  searchProvider,
  siriRequireMutationConfirmation,
  semanticCacheEnabled,
  semanticCacheFreshSeconds,
  semanticCacheStaleIfErrorSeconds,
  sessionTtlHours,
  basicAuthUser,
  basicAuthPass,
  appBaseUrl,
  awsRegion,
  s3Bucket,
  corsAllowOrigins,
  pineconeApiKey,
  pineconeIndexName,
  pineconeIndexHost,
  pineconeNamespace,
  pineconeTextField,
  pineconeRerankModel,
};
