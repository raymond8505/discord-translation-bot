import { describe, expect, it, vi } from "vitest";
import { createCache, sourceKey, translationKey } from "./cache.js";
import { makeCacheEntry } from "./fixtures/cache.fixture.js";
import { makeFakeRedis } from "./fixtures/redis.fixture.js";
import type { Logger } from "./log.js";

const TTL = 3600;
const MESSAGE_ID = "111111111111111111";

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("createCache", () => {
  it("stores a translation as JSON with the configured TTL", async () => {
    const redis = makeFakeRedis();
    const cache = createCache(redis, TTL);
    const entry = makeCacheEntry();

    await cache.set(MESSAGE_ID, "en", entry);

    const record = redis.store.get(translationKey(MESSAGE_ID, "en"));
    expect(record?.ex).toBe(TTL);
    expect(JSON.parse(record?.value ?? "")).toEqual(entry);
    await expect(cache.get(MESSAGE_ID, "en")).resolves.toEqual(entry);
  });

  it("returns null on a miss", async () => {
    const cache = createCache(makeFakeRedis(), TTL);
    await expect(cache.get(MESSAGE_ID, "en")).resolves.toBeNull();
  });

  it("treats corrupt or mis-shaped entries as misses and warns", async () => {
    const logger = makeLogger();
    const redis = makeFakeRedis({
      [translationKey(MESSAGE_ID, "en")]: "{not json",
      [translationKey(MESSAGE_ID, "fr")]: JSON.stringify({ text: 1 }),
    });
    const cache = createCache(redis, TTL, logger);

    await expect(cache.get(MESSAGE_ID, "en")).resolves.toBeNull();
    await expect(cache.get(MESSAGE_ID, "fr")).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("stores and reads the source text with the same TTL", async () => {
    const redis = makeFakeRedis();
    const cache = createCache(redis, TTL);

    await cache.setSource(MESSAGE_ID, "hola");

    expect(redis.store.get(sourceKey(MESSAGE_ID))?.ex).toBe(TTL);
    await expect(cache.getSource(MESSAGE_ID)).resolves.toBe("hola");
    await expect(cache.getSource("other")).resolves.toBeNull();
  });

  it("invalidates every translation and the source across scan batches, leaving other messages", async () => {
    const redis = makeFakeRedis();
    const cache = createCache(redis, TTL);
    const targets = ["en", "fr", "de", "es", "ja", "ko", "zh"];
    for (const target of targets) await cache.set(MESSAGE_ID, target, makeCacheEntry());
    await cache.setSource(MESSAGE_ID, "hola");
    await cache.set("222222222222222222", "en", makeCacheEntry());
    // Force several SCAN pages by making the fake page over the seeded keys.
    const paged = { ...redis, scanIterator: (o: { MATCH: string; COUNT: number }) => redis.scanIterator({ ...o, COUNT: 3 }) };

    const deleted = await createCache(paged, TTL).invalidate(MESSAGE_ID);

    expect(deleted).toBe(targets.length + 1);
    for (const target of targets) expect(redis.store.has(translationKey(MESSAGE_ID, target))).toBe(false);
    expect(redis.store.has(sourceKey(MESSAGE_ID))).toBe(false);
    expect(redis.store.has(translationKey("222222222222222222", "en"))).toBe(true);
    expect(redis.delCalls.length).toBeGreaterThan(2);
  });

  it("never issues an empty DEL and reports zero when nothing is cached", async () => {
    const redis = makeFakeRedis();
    const cache = createCache(redis, TTL);

    await expect(cache.invalidate(MESSAGE_ID)).resolves.toBe(0);
    expect(redis.delCalls).toEqual([[sourceKey(MESSAGE_ID)]]);
  });
});
