import type { RedisLike } from "./cache.js";
import { log, type Logger } from "./log.js";

/** One message the bot posted, and what it was a translation of. */
export interface PostRef {
  readonly channelId: string;
  readonly messageId: string;
  readonly target: string;
  /** The source that produced it: a forced code, or `auto`. */
  readonly source: string;
}

/**
 * What the bot has said about a message, so an edit to that message can reach
 * the translations already sitting in the channel. Keyed by the same sourceId
 * as the cache, but deliberately outside `cache.invalidate()`: the registry has
 * to survive the edit that triggers the refresh.
 */
export interface PostRegistry {
  /** Appends a post, or replaces the entry for a message id already recorded. */
  record(sourceId: string, ref: PostRef): Promise<void>;
  list(sourceId: string): Promise<PostRef[]>;
  /** Drops one post, for a message that is gone from Discord. */
  forget(sourceId: string, messageId: string): Promise<void>;
  drop(sourceId: string): Promise<void>;
}

export function postsKey(sourceId: string): string {
  return `post:${sourceId}`;
}

function isPostRef(value: unknown): value is PostRef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.channelId === "string" &&
    typeof v.messageId === "string" &&
    typeof v.target === "string" &&
    typeof v.source === "string"
  );
}

export function createPostRegistry(
  redis: RedisLike,
  ttlSeconds: number,
  logger: Logger = log,
): PostRegistry {
  async function read(sourceId: string): Promise<PostRef[]> {
    const key = postsKey(sourceId);
    const raw = await redis.get(key);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(isPostRef);
      logger.warn(`post registry ${key} is not an array; treating as empty`);
    } catch {
      logger.warn(`post registry ${key} is not valid JSON; treating as empty`);
    }
    return [];
  }

  async function write(sourceId: string, refs: readonly PostRef[]): Promise<void> {
    if (refs.length === 0) {
      await redis.del([postsKey(sourceId)]);
      return;
    }
    // Re-set rather than EXPIRE: the whole entry is rewritten anyway, and a
    // message still being translated is one whose registry should outlive the
    // TTL the first post started.
    await redis.set(postsKey(sourceId), JSON.stringify(refs), { EX: ttlSeconds });
  }

  return {
    async record(sourceId, ref) {
      const refs = await read(sourceId);
      // One entry per message id, so a source edit rewrites each post exactly once.
      await write(sourceId, [...refs.filter((other) => other.messageId !== ref.messageId), ref]);
    },

    list: read,

    async forget(sourceId, messageId) {
      const refs = await read(sourceId);
      const kept = refs.filter((ref) => ref.messageId !== messageId);
      if (kept.length === refs.length) return;
      await write(sourceId, kept);
    },

    async drop(sourceId) {
      await redis.del([postsKey(sourceId)]);
    },
  };
}
