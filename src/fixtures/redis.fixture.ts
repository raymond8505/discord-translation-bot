import type { RedisLike } from "../cache.js";
import type { RateLimitRedis } from "../rateLimit.js";

export interface FakeRedisRecord {
  value: string;
  ex: number;
}

export interface FakeRedis extends RedisLike, RateLimitRedis {
  /** Backing store, exposed for assertions. */
  readonly store: Map<string, FakeRedisRecord>;
  /** Every `del` call's argument, in order. */
  readonly delCalls: string[][];
  /** Every `expire` call, in order, so a test can prove a window is bounded. */
  readonly expireCalls: Array<{ key: string; seconds: number }>;
}

/**
 * A Redis whose every command rejects, for the outage paths: the cache treats
 * one as a miss and the rate limiter allows the request through.
 */
export function makeFailingRedis(message = "ECONNREFUSED"): FakeRedis {
  const fail = (): never => {
    throw new Error(message);
  };
  return {
    ...makeFakeRedis(),
    get: fail,
    set: fail,
    del: fail,
    incr: fail,
    expire: fail,
    scanIterator: fail,
  };
}

/**
 * A Redis whose commands never settle, for the outage that is worse than an
 * error: node-redis queues commands against a dead server and only rejects on
 * its own 5 s timeout, so callers must impose their own deadline.
 */
export function makeHangingRedis(): FakeRedis {
  const hang = (): Promise<never> => new Promise(() => undefined);
  return {
    ...makeFakeRedis(),
    get: hang,
    set: hang,
    del: hang,
    incr: hang,
    expire: hang,
    scanIterator: hang as unknown as FakeRedis["scanIterator"],
  };
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * In-memory stand-in for the node-redis slice the cache uses. `scanIterator`
 * yields an empty batch first and then real batches of `COUNT`, mirroring
 * how SCAN can return empty pages, so the empty-batch guard is exercised.
 * `del([])` throws, as the real server rejects DEL with no keys.
 */
export function makeFakeRedis(seed: Record<string, string> = {}): FakeRedis {
  const store = new Map<string, FakeRedisRecord>();
  for (const [key, value] of Object.entries(seed)) store.set(key, { value, ex: 0 });
  const delCalls: string[][] = [];
  const expireCalls: Array<{ key: string; seconds: number }> = [];

  return {
    store,
    delCalls,
    expireCalls,
    async get(key) {
      return store.get(key)?.value ?? null;
    },
    // Redis creates a missing key at 0 before incrementing, and the reply is the
    // new value — that "1 means first in the window" is what the limiter's TTL
    // hangs on, so the fake has to reproduce it exactly.
    async incr(key) {
      const next = Number(store.get(key)?.value ?? "0") + 1;
      store.set(key, { value: String(next), ex: store.get(key)?.ex ?? 0 });
      return next;
    },
    async expire(key, seconds) {
      expireCalls.push({ key, seconds });
      const record = store.get(key);
      if (!record) return false;
      record.ex = seconds;
      return true;
    },
    async set(key, value, options) {
      store.set(key, { value, ex: options.EX });
      return "OK";
    },
    async del(keys) {
      if (keys.length === 0) throw new Error("ERR wrong number of arguments for 'del' command");
      delCalls.push([...keys]);
      let removed = 0;
      for (const key of keys) if (store.delete(key)) removed += 1;
      return removed;
    },
    async *scanIterator({ MATCH, COUNT }) {
      const re = globToRegExp(MATCH);
      const matching = [...store.keys()].filter((key) => re.test(key));
      yield [];
      for (let i = 0; i < matching.length; i += COUNT) {
        yield matching.slice(i, i + COUNT);
      }
    },
  };
}
