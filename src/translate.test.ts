import { describe, expect, it } from "vitest";
import { BackendError } from "./backends/index.js";
import { sourceKey, translationKey } from "./cache.js";
import { makeFakeBackend } from "./fixtures/backend.fixture.js";
import { makeCacheEntry } from "./fixtures/cache.fixture.js";
import { makeContext } from "./fixtures/context.fixture.js";
import { makeFakeRedis } from "./fixtures/redis.fixture.js";
import { MAX_INPUT_CHARS, translateWithCache } from "./translate.js";

const ID = "123456789012345678";

describe("translateWithCache", () => {
  it("returns a cached entry without calling the backend", async () => {
    const entry = makeCacheEntry({ source_lang: "es" });
    const redis = makeFakeRedis({ [translationKey(ID, "en")]: JSON.stringify(entry) });
    const ctx = makeContext({ redis });

    const outcome = await translateWithCache(ctx, { sourceId: ID, text: "hola", target: "en" });

    expect(outcome).toEqual({ entry, target: "en", cached: true, sameLanguage: false });
    expect(ctx.backend.translateCalls).toHaveLength(0);
  });

  it("translates on a miss with auto-detection and stores both the entry and the source", async () => {
    const ctx = makeContext({ ttlSeconds: 42 });

    const outcome = await translateWithCache(ctx, { sourceId: ID, text: "hola", target: "en" });

    expect(ctx.backend.translateCalls).toEqual([{ text: "hola", source: "auto", target: "en" }]);
    expect(outcome.cached).toBe(false);
    expect(outcome.entry).toMatchObject({ text: "[en] hola", backend: "fake", source_lang: "es" });
    expect(Date.parse(outcome.entry.created_at)).not.toBeNaN();
    expect(ctx.redis.store.get(translationKey(ID, "en"))?.ex).toBe(42);
    expect(ctx.redis.store.get(sourceKey(ID))).toEqual({ value: "hola", ex: 42 });
  });

  it("flags a translation whose detected source equals the target", async () => {
    const ctx = makeContext();

    const outcome = await translateWithCache(ctx, { sourceId: ID, text: "hola", target: "es" });

    expect(outcome.sameLanguage).toBe(true);
  });

  it("caps the text sent to the backend at the Discord message limit", async () => {
    const ctx = makeContext();

    await translateWithCache(ctx, { sourceId: ID, text: "x".repeat(MAX_INPUT_CHARS + 500), target: "en" });

    expect(ctx.backend.translateCalls[0]?.text).toHaveLength(MAX_INPUT_CHARS);
  });

  it("degrades to uncached when Redis fails, and logs it", async () => {
    const redis = makeFakeRedis();
    redis.get = async () => {
      throw new Error("ECONNREFUSED");
    };
    redis.set = async () => {
      throw new Error("ECONNREFUSED");
    };
    const ctx = makeContext({ redis });

    const outcome = await translateWithCache(ctx, { sourceId: ID, text: "hola", target: "en" });

    expect(outcome.cached).toBe(false);
    expect(outcome.entry.text).toBe("[en] hola");
    expect(ctx.log.entries.filter((e) => e.level === "warn")).toHaveLength(3);
  });

  it("lets backend failures propagate untouched", async () => {
    const backend = makeFakeBackend({
      translate: async () => {
        throw new BackendError("timeout", "slow");
      },
    });
    const ctx = makeContext({ backend });

    await expect(
      translateWithCache(ctx, { sourceId: ID, text: "hola", target: "en" }),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(ctx.redis.store.size).toBe(0);
  });
});
