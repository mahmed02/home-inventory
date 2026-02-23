import { env } from "../config/env";

export type EmbeddingProvider = {
  model: string;
  dimensions: number;
  embed(input: string): Promise<number[]>;
};

function clampDimensions(value: number): number {
  if (!Number.isFinite(value)) {
    return 64;
  }
  return Math.min(Math.max(Math.trunc(value), 8), 2048);
}

function fnv1aHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function normalizeVector(values: number[]): number[] {
  const magnitude = Math.sqrt(values.reduce((sum, entry) => sum + entry * entry, 0));
  if (magnitude <= 0) {
    return values;
  }
  return values.map((entry) => entry / magnitude);
}

function deterministicEmbedding(input: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(input);

  for (const token of tokens) {
    const index = fnv1aHash(token) % dimensions;
    const sign = fnv1aHash(`${token}:sign`) % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  return normalizeVector(vector);
}

function createDeterministicProvider(): EmbeddingProvider {
  const dimensions = clampDimensions(env.embeddingDimensions);
  return {
    model: `deterministic-v1-${dimensions}`,
    dimensions,
    async embed(input: string): Promise<number[]> {
      return deterministicEmbedding(input, dimensions);
    },
  };
}

let cachedProvider: EmbeddingProvider | null = null;

export function resolveEmbeddingProvider(): EmbeddingProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  switch (env.embeddingsProvider) {
    case "deterministic":
    default:
      cachedProvider = createDeterministicProvider();
      return cachedProvider;
  }
}
