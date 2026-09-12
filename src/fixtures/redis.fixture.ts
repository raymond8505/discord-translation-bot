import type { RedisLike } from "../cache.js";

export interface FakeRedisRecord {
  value: string;
  ex: number;
}

export interface FakeRedis extends RedisLike {
  /** Backing store, exposed for assertions. */
  readonly store: Map<string, FakeRedisRecord>;
  /** Every `del` call's argument, in order. */
  readonly delCalls: string[][];
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

  return {
    store,
    delCalls,
    async get(key) {
      return store.get(key)?.value ?? null;
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
