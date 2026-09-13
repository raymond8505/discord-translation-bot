import { describe, expect, it } from "vitest";
import { BackendError } from "./backends/index.js";
import { sourceKey, translationKey } from "./cache.js";
import { makeFakeBackend, unsureTranslate } from "./fixtures/backend.fixture.js";
import { makeCacheEntry } from "./fixtures/cache.fixture.js";
import { makeContext } from "./fixtures/context.fixture.js";
import { makeFakeRedis } from "./fixtures/redis.fixture.js";
import { INFER_SOURCE_BELOW_PERCENT, MAX_INPUT_CHARS, translateWithCache } from "./translate.js";

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

  it("keeps the backend's detection confidence in the entry", async () => {
    const backend = makeFakeBackend({
      translate: async () => ({ text: "hi", detectedSource: "es", confidence: 45 }),
    });
    const ctx = makeContext({ backend });

    const outcome = await translateWithCache(ctx, { sourceId: ID, text: "hola", target: "en" });

    expect(outcome.entry.confidence).toBe(45);
    expect(JSON.parse(ctx.redis.store.get(translationKey(ID, "en"))?.value ?? "")).toMatchObject({ confidence: 45 });
  });

  it("with a forced source, skips the cached entry, overwrites it, and records no confidence", async () => {
    const stale = makeCacheEntry({ text: "wrong", source_lang: "es", confidence: 45 });
    const redis = makeFakeRedis({ [translationKey(ID, "en")]: JSON.stringify(stale) });
    const backend = makeFakeBackend({
      translate: async (text, source) => ({ text: `[${source}] ${text}`, detectedSource: source }),
    });
    const ctx = makeContext({ redis, backend });

    const outcome = await translateWithCache(ctx, { sourceId: ID, text: "j'adore", target: "en", source: "fr" });

    expect(ctx.backend.translateCalls).toEqual([{ text: "j'adore", source: "fr", target: "en" }]);
    expect(outcome.cached).toBe(false);
    expect(outcome.entry).toMatchObject({ text: "[fr] j'adore", source_lang: "fr" });
    expect(outcome.entry).not.toHaveProperty("confidence");
    expect(await ctx.cache.get(ID, "en")).toMatchObject({ text: "[fr] j'adore" });
  });

  it("re-translates from the author's language when the detection is barely a guess", async () => {
    const ctx = makeContext({ backend: makeFakeBackend({ translate: unsureTranslate(15) }) });

    const outcome = await translateWithCache(ctx, {
      sourceId: ID,
      text: "ok",
      target: "fr",
      fallbackSource: "en",
    });

    expect(ctx.backend.translateCalls.map((c) => c.source)).toEqual(["auto", "en"]);
    expect(outcome.entry).toMatchObject({ text: "[en→fr] ok", source_lang: "en", source_inferred: true });
    expect(outcome.entry).not.toHaveProperty("confidence");
    expect(await ctx.cache.get(ID, "fr")).toMatchObject({ source_inferred: true });
    expect(ctx.log.entries.some((e) => e.level === "info")).toBe(true);
  });

  it("trusts a detection at the confidence floor and keeps its score", async () => {
    const ctx = makeContext({
      backend: makeFakeBackend({ translate: unsureTranslate(INFER_SOURCE_BELOW_PERCENT) }),
    });

    const outcome = await translateWithCache(ctx, { sourceId: ID, text: "ok", target: "fr", fallbackSource: "en" });

    expect(ctx.backend.translateCalls).toHaveLength(1);
    expect(outcome.entry.confidence).toBe(INFER_SOURCE_BELOW_PERCENT);
    expect(outcome.entry).not.toHaveProperty("source_inferred");
  });

  it("leaves a weak detection alone when it already agrees with the author's language", async () => {
    const ctx = makeContext({ backend: makeFakeBackend({ translate: unsureTranslate(15) }) });

    const outcome = await translateWithCache(ctx, { sourceId: ID, text: "ok", target: "fr", fallbackSource: "es" });

    expect(ctx.backend.translateCalls).toHaveLength(1);
    expect(outcome.entry).toMatchObject({ source_lang: "es", confidence: 15 });
  });

  it("never second-guesses a forced source, and needs a fallback to act at all", async () => {
    const ctx = makeContext({ backend: makeFakeBackend({ translate: unsureTranslate(15) }) });

    await translateWithCache(ctx, { sourceId: ID, text: "ok", target: "fr", source: "de", fallbackSource: "en" });
    const detected = await translateWithCache(ctx, { sourceId: "other", text: "ok", target: "fr" });

    expect(ctx.backend.translateCalls.map((c) => c.source)).toEqual(["de", "auto"]);
    expect(detected.entry).toMatchObject({ source_lang: "es", confidence: 15 });
  });

  it("flags an inferred source that is already the target", async () => {
    const ctx = makeContext({ backend: makeFakeBackend({ translate: unsureTranslate(15) }) });

    const outcome = await translateWithCache(ctx, { sourceId: ID, text: "ok", target: "en", fallbackSource: "en" });

    expect(outcome.sameLanguage).toBe(true);
    expect(outcome.entry.source_inferred).toBe(true);
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
