import { describe, expect, it, vi } from "vitest";
import { createCache, sourceKey, translationKey } from "./cache.js";
import { makeCacheEntry } from "./fixtures/cache.fixture.js";
import { makeFakeRedis } from "./fixtures/redis.fixture.js";
import type { Logger } from "./log.js";
import { contentHash } from "./sourceId.js";

const TTL = 3600;
const MESSAGE_ID = "111111111111111111";
const HASH = contentHash("hola");

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("createCache", () => {
  it("stores a translation as JSON with the configured TTL", async () => {
    const redis = makeFakeRedis();
    const cache = createCache(redis, TTL);
    const entry = makeCacheEntry();

    await cache.set(HASH, "auto", "en", entry);

    const record = redis.store.get(translationKey(HASH, "auto", "en"));
    expect(record?.ex).toBe(TTL);
    expect(JSON.parse(record?.value ?? "")).toEqual(entry);
    await expect(cache.get(HASH, "auto", "en")).resolves.toEqual(entry);
  });

  it("returns null on a miss", async () => {
    const cache = createCache(makeFakeRedis(), TTL);
    await expect(cache.get(HASH, "auto", "en")).resolves.toBeNull();
  });

  it("keeps the requested source in the key, so a forced source never reads an auto entry", async () => {
    const redis = makeFakeRedis();
    const cache = createCache(redis, TTL);

    await cache.set(HASH, "auto", "en", makeCacheEntry({ text: "detected" }));
    await cache.set(HASH, "fr", "en", makeCacheEntry({ text: "forced" }));

    await expect(cache.get(HASH, "auto", "en")).resolves.toMatchObject({ text: "detected" });
    await expect(cache.get(HASH, "fr", "en")).resolves.toMatchObject({ text: "forced" });
    await expect(cache.get(HASH, "de", "en")).resolves.toBeNull();
  });

  it("treats corrupt or mis-shaped entries as misses and warns", async () => {
    const logger = makeLogger();
    const redis = makeFakeRedis({
      [translationKey(HASH, "auto", "en")]: "{not json",
      [translationKey(HASH, "auto", "fr")]: JSON.stringify({ text: 1 }),
    });
    const cache = createCache(redis, TTL, logger);

    await expect(cache.get(HASH, "auto", "en")).resolves.toBeNull();
    await expect(cache.get(HASH, "auto", "fr")).resolves.toBeNull();
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

  it("invalidates the stored source only, leaving the content-keyed translations to their TTL", async () => {
    const redis = makeFakeRedis();
    const cache = createCache(redis, TTL);
    await cache.set(HASH, "auto", "en", makeCacheEntry());
    await cache.setSource(MESSAGE_ID, "hola");

    const deleted = await cache.invalidate(MESSAGE_ID);

    expect(deleted).toBe(1);
    expect(redis.store.has(sourceKey(MESSAGE_ID))).toBe(false);
    // The entry survives on purpose: edited text hashes elsewhere, so nothing
    // can reach this one again and it ages out rather than needing a sweep.
    expect(redis.store.has(translationKey(HASH, "auto", "en"))).toBe(true);
    expect(redis.delCalls).toEqual([[sourceKey(MESSAGE_ID)]]);
  });

  it("never issues an empty DEL and reports zero when nothing is cached", async () => {
    const redis = makeFakeRedis();
    const cache = createCache(redis, TTL);

    await expect(cache.invalidate(MESSAGE_ID)).resolves.toBe(0);
    expect(redis.delCalls).toEqual([[sourceKey(MESSAGE_ID)]]);
  });
});
