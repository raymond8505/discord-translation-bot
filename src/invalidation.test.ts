import { describe, expect, it } from "vitest";
import { sourceKey, translationKey } from "./cache.js";
import { makeContext } from "./fixtures/context.fixture.js";
import { MESSAGE_ID } from "./fixtures/interaction.fixture.js";
import { makeFakeRedis } from "./fixtures/redis.fixture.js";
import { createMessageInvalidator, shouldInvalidateOnUpdate } from "./invalidation.js";

const full = (content: string | null) => ({ id: MESSAGE_ID, partial: false, content });
const partial = () => ({ id: MESSAGE_ID, partial: true, content: null });

describe("shouldInvalidateOnUpdate", () => {
  it("is true when the text changed or the old message is partial", () => {
    expect(shouldInvalidateOnUpdate(full("a"), full("b"))).toBe(true);
    expect(shouldInvalidateOnUpdate(partial(), full("a"))).toBe(true);
  });

  it("is false for an edit that left the text alone (embed unfurl, pin)", () => {
    expect(shouldInvalidateOnUpdate(full("a"), full("a"))).toBe(false);
  });
});

describe("createMessageInvalidator", () => {
  function seeded() {
    return makeFakeRedis({
      [translationKey(MESSAGE_ID, "en")]: "{}",
      [sourceKey(MESSAGE_ID)]: "hola",
      [translationKey("222222222222222222", "en")]: "{}",
    });
  }

  it("drops a message's keys on a real edit and on delete", async () => {
    const edited = makeContext({ redis: seeded() });
    await createMessageInvalidator(edited).onUpdate(full("a"), full("b"));
    expect(edited.redis.store.has(translationKey(MESSAGE_ID, "en"))).toBe(false);
    expect(edited.redis.store.has(sourceKey(MESSAGE_ID))).toBe(false);
    expect(edited.redis.store.has(translationKey("222222222222222222", "en"))).toBe(true);

    const deleted = makeContext({ redis: seeded() });
    await createMessageInvalidator(deleted).onDelete(partial());
    expect(deleted.redis.store.has(translationKey(MESSAGE_ID, "en"))).toBe(false);
  });

  it("leaves the cache alone for a no-op edit", async () => {
    const ctx = makeContext({ redis: seeded() });

    await createMessageInvalidator(ctx).onUpdate(full("a"), full("a"));

    expect(ctx.redis.delCalls).toEqual([]);
  });

  it("logs and swallows cache failures", async () => {
    const redis = seeded();
    redis.del = async () => {
      throw new Error("ECONNREFUSED");
    };
    const ctx = makeContext({ redis });

    await expect(createMessageInvalidator(ctx).onDelete(full("a"))).resolves.toBeUndefined();

    expect(ctx.log.entries[0]).toMatchObject({ level: "warn" });
  });
});
