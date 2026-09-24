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
  /** Every `expire` and `getEx` call, in order: a bounded window, or a slid TTL. */
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
    getEx: fail,
    set: fail,
    del: fail,
    incr: fail,
    expire: fail,
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
    getEx: hang,
    set: hang,
    del: hang,
    incr: hang,
    expire: hang,
  };
}

/**
 * In-memory stand-in for the node-redis slice the cache uses. `del([])` throws,
 * as the real server rejects DEL with no keys.
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
    // Real GETEX leaves a missing key alone and records no expiry, which is how
    // a test tells "slid the TTL on a hit" from "slid it on a miss too".
    async getEx(key, options) {
      const record = store.get(key);
      if (!record) return null;
      expireCalls.push({ key, seconds: options.value });
      record.ex = options.value;
      return record.value;
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
  };
}
