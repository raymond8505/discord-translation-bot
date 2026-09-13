import { log, type Logger } from "./log.js";

export interface CacheEntry {
  readonly text: string;
  readonly backend: string;
  readonly source_lang: string;
  readonly created_at: string;
  /** Detection confidence 0-100; absent when the source was given explicitly or inferred. */
  readonly confidence?: number;
  /** The source was taken from the author's Discord language after an unusable detection. */
  readonly source_inferred?: true;
}

/**
 * The slice of node-redis the cache uses, as a structural type so tests run
 * against an in-memory fake and a client swap never touches this module.
 * `scanIterator` yields batches of keys (node-redis >= 5 semantics).
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(keys: string[]): Promise<number>;
  scanIterator(options: { MATCH: string; COUNT: number }): AsyncIterable<string[]>;
}

export interface TranslationCache {
  get(sourceId: string, target: string): Promise<CacheEntry | null>;
  set(sourceId: string, target: string, entry: CacheEntry): Promise<void>;
  /** Original text, kept so the re-translate menu works without re-fetching the message. */
  getSource(sourceId: string): Promise<string | null>;
  setSource(sourceId: string, text: string): Promise<void>;
  /** Drops every translation and the stored source for one message. Returns keys deleted. */
  invalidate(sourceId: string): Promise<number>;
}

export function translationKey(sourceId: string, target: string): string {
  return `tr:${sourceId}:${target}`;
}

export function sourceKey(sourceId: string): string {
  return `src:${sourceId}`;
}

const SCAN_COUNT = 100;

function isCacheEntry(value: unknown): value is CacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.text === "string" &&
    typeof v.backend === "string" &&
    typeof v.source_lang === "string" &&
    typeof v.created_at === "string" &&
    (v.confidence === undefined || typeof v.confidence === "number") &&
    (v.source_inferred === undefined || v.source_inferred === true)
  );
}

export function createCache(
  redis: RedisLike,
  ttlSeconds: number,
  logger: Logger = log,
): TranslationCache {
  return {
    async get(sourceId, target) {
      const key = translationKey(sourceId, target);
      const raw = await redis.get(key);
      if (raw === null) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isCacheEntry(parsed)) return parsed;
        logger.warn(`cache entry ${key} has an unexpected shape; treating as miss`);
      } catch {
        logger.warn(`cache entry ${key} is not valid JSON; treating as miss`);
      }
      return null;
    },

    async set(sourceId, target, entry) {
      await redis.set(translationKey(sourceId, target), JSON.stringify(entry), { EX: ttlSeconds });
    },

    async getSource(sourceId) {
      return redis.get(sourceKey(sourceId));
    },

    async setSource(sourceId, text) {
      await redis.set(sourceKey(sourceId), text, { EX: ttlSeconds });
    },

    async invalidate(sourceId) {
      let deleted = 0;
      // SCAN, never KEYS: KEYS blocks the server for the whole keyspace.
      for await (const keys of redis.scanIterator({
        MATCH: translationKey(sourceId, "*"),
        COUNT: SCAN_COUNT,
      })) {
        if (keys.length > 0) deleted += await redis.del(keys);
      }
      deleted += await redis.del([sourceKey(sourceId)]);
      return deleted;
    },
  };
}
