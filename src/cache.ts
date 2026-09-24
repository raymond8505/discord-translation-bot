import { log, type Logger } from "./log.js";

export interface CacheEntry {
  readonly text: string;
  readonly backend: string;
  readonly source_lang: string;
  readonly created_at: string;
  /** Detection confidence 0-100; absent when the source was given explicitly. */
  readonly confidence?: number;
}

/**
 * The slice of node-redis the cache uses, as a structural type so tests run
 * against an in-memory fake and a client swap never touches this module.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(keys: string[]): Promise<number>;
}

/**
 * Two keyings, on purpose. A translation is keyed by `contentHash` of the text
 * plus the requested source and target: the same string reposted in ten
 * messages is one entry, and the backend sees it once. The stored source text
 * is keyed by the message it came from, because edit-follow and the
 * re-translate menu ask where something was said, not what.
 */
export interface TranslationCache {
  get(hash: string, source: string, target: string): Promise<CacheEntry | null>;
  set(hash: string, source: string, target: string, entry: CacheEntry): Promise<void>;
  /** Original text, kept so the re-translate menu works without re-fetching the message. */
  getSource(sourceId: string): Promise<string | null>;
  setSource(sourceId: string, text: string): Promise<void>;
  /** Drops the stored source text for one message. Returns keys deleted. */
  invalidate(sourceId: string): Promise<number>;
}

/** `source` is the *requested* source ("auto" or a forced code), never the detected one. */
export function translationKey(hash: string, source: string, target: string): string {
  return `tr:${hash}:${source}:${target}`;
}

export function sourceKey(sourceId: string): string {
  return `src:${sourceId}`;
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.text === "string" &&
    typeof v.backend === "string" &&
    typeof v.source_lang === "string" &&
    typeof v.created_at === "string" &&
    (v.confidence === undefined || typeof v.confidence === "number")
  );
}

export function createCache(
  redis: RedisLike,
  ttlSeconds: number,
  logger: Logger = log,
): TranslationCache {
  return {
    async get(hash, source, target) {
      const key = translationKey(hash, source, target);
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

    async set(hash, source, target, entry) {
      await redis.set(translationKey(hash, source, target), JSON.stringify(entry), {
        EX: ttlSeconds,
      });
    },

    async getSource(sourceId) {
      return redis.get(sourceKey(sourceId));
    },

    async setSource(sourceId, text) {
      await redis.set(sourceKey(sourceId), text, { EX: ttlSeconds });
    },

    // Only the stored source. Translations need no sweep: they are keyed by
    // content, so edited text hashes to a different key and the old entry is
    // never looked up again. It lingers, unreachable, until its TTL — which is
    // cheaper than keeping a message-to-hash index alive just to delete it.
    async invalidate(sourceId) {
      return redis.del([sourceKey(sourceId)]);
    },
  };
}
