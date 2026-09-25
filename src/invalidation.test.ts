import { describe, expect, it } from "vitest";
import { sourceKey, translationKey } from "./cache.js";
import { makeCacheEntry } from "./fixtures/cache.fixture.js";
import { alwaysLimited, makeContext } from "./fixtures/context.fixture.js";
import { MESSAGE_ID } from "./fixtures/interaction.fixture.js";
import { makeEditedMessage } from "./fixtures/invalidation.fixture.js";
import { makeFakeMessageEditor } from "./fixtures/messageEditor.fixture.js";
import { frenchMessages } from "./fixtures/messages.fixture.js";
import { makePostRef, POSTED_MESSAGE_ID } from "./fixtures/post.fixture.js";
import { makeFakeRedis } from "./fixtures/redis.fixture.js";
import { createMessageInvalidator, shouldInvalidateOnUpdate } from "./invalidation.js";
import { postsKey } from "./posts.js";
import { contentHash } from "./sourceId.js";

const full = (content: string | null) => makeEditedMessage({ content });
const partial = () => makeEditedMessage({ partial: true });

const OTHER_POST_ID = "456789012345678999";

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
  function seeded(extra: Record<string, string> = {}) {
    return makeFakeRedis({
      [translationKey(contentHash("hola"), "auto", "fr")]: JSON.stringify(
        makeCacheEntry({ text: "[fr] STALE" }),
      ),
      [sourceKey(MESSAGE_ID)]: "hola",
      ...extra,
    });
  }

  /** A registry holding one post per target, as the triggers would have left it. */
  function withPosts(...targets: readonly string[]) {
    const refs = targets.map((target, index) =>
      makePostRef({ target, messageId: index === 0 ? POSTED_MESSAGE_ID : OTHER_POST_ID }),
    );
    return seeded({ [postsKey(MESSAGE_ID)]: JSON.stringify(refs) });
  }

  it("drops the stored source on a real edit and on delete", async () => {
    const edited = makeContext({ redis: seeded() });
    await createMessageInvalidator(edited).onUpdate(full("a"), full("b"));
    expect(edited.redis.store.has(sourceKey(MESSAGE_ID))).toBe(false);
    // Translations are content-keyed, so the edit cannot strand one: the new
    // text hashes elsewhere and this entry is simply never read again.
    expect(edited.redis.store.has(translationKey(contentHash("hola"), "auto", "fr"))).toBe(true);

    const deleted = makeContext({ redis: seeded() });
    await createMessageInvalidator(deleted).onDelete(partial());
    expect(deleted.redis.store.has(sourceKey(MESSAGE_ID))).toBe(false);
  });

  it("re-translates an edit rather than serving the entry the old text left behind", async () => {
    const ctx = makeContext({ redis: withPosts("fr") });

    await createMessageInvalidator(ctx).onUpdate(full("hola"), full("adios"));

    expect(ctx.backend.translateCalls).toEqual([{ text: "adios", source: "auto", target: "fr" }]);
    expect(ctx.messages.edits[0]?.payload.embeds[0]?.toJSON().description).toContain("[fr] adios");
    expect(ctx.redis.store.has(translationKey(contentHash("hola"), "auto", "fr"))).toBe(true);
  });

  it("forgets what it posted about a deleted message", async () => {
    const ctx = makeContext({ redis: withPosts("fr") });

    await createMessageInvalidator(ctx).onDelete(full("a"));

    expect(ctx.redis.store.has(postsKey(MESSAGE_ID))).toBe(false);
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

  it("does nothing when the new text matches the text already translated", async () => {
    const ctx = makeContext({ redis: withPosts("fr") });

    // A partial `oldMessage` carries no content, so the comparison cannot rule
    // this out — an unfurl on pre-boot history arrives looking exactly like this.
    await createMessageInvalidator(ctx).onUpdate(partial(), full("hola"));

    expect(ctx.redis.delCalls).toEqual([]);
    expect(ctx.backend.translateCalls).toEqual([]);
    expect(ctx.messages.edits).toEqual([]);
  });

  it("re-translates and edits every post it made about the message", async () => {
    const ctx = makeContext({ redis: withPosts("fr", "de") });

    await createMessageInvalidator(ctx).onUpdate(full("hola"), full("adios"));

    expect(ctx.backend.translateCalls).toEqual([
      { text: "adios", source: "auto", target: "fr" },
      { text: "adios", source: "auto", target: "de" },
    ]);
    expect(ctx.messages.edits.map((edit) => edit.ref.target)).toEqual(["fr", "de"]);
    expect(ctx.messages.edits[0]?.payload.embeds[0]?.toJSON().description).toBe("[fr] adios");
  });

  it("rewrites each post in its own target's language", async () => {
    const ctx = makeContext({ redis: withPosts("fr", "de") });

    await createMessageInvalidator(ctx).onUpdate(full("hola"), full("adios"));

    // Each post is the language its readers asked for, and a rewrite has to keep
    // it: one translator for the whole refresh re-worded them all as the guild.
    expect(ctx.messages.edits.map((edit) => edit.payload.embeds[0]?.toJSON().title)).toEqual([
      `${frenchMessages["reply.title"]} → Français`,
      "Translation → Deutsch",
    ]);
  });

  it("keeps a forced source when it re-translates", async () => {
    const refs = [makePostRef({ target: "en", source: "es" })];
    const ctx = makeContext({ redis: seeded({ [postsKey(MESSAGE_ID)]: JSON.stringify(refs) }) });

    await createMessageInvalidator(ctx).onUpdate(full("hola"), full("adios"));

    expect(ctx.backend.translateCalls).toEqual([{ text: "adios", source: "es", target: "en" }]);
  });

  it("fetches a partial message before translating it", async () => {
    const ctx = makeContext({ redis: withPosts("fr") });
    const edited = makeEditedMessage({ partial: true, fetched: "adios" });

    await createMessageInvalidator(ctx).onUpdate(partial(), edited);

    expect(edited.fetchCalls).toEqual([MESSAGE_ID]);
    expect(ctx.backend.translateCalls).toEqual([{ text: "adios", source: "auto", target: "fr" }]);
  });

  it("stops at a message it cannot fetch", async () => {
    const ctx = makeContext({ redis: withPosts("fr") });

    await createMessageInvalidator(ctx).onUpdate(partial(), makeEditedMessage({ partial: true, unreadable: true }));

    expect(ctx.redis.delCalls).toEqual([]);
    expect(ctx.messages.edits).toEqual([]);
  });

  it("invalidates but posts nothing when it never posted about the message", async () => {
    const ctx = makeContext({ redis: seeded() });

    await createMessageInvalidator(ctx).onUpdate(full("hola"), full("adios"));

    expect(ctx.redis.store.has(sourceKey(MESSAGE_ID))).toBe(false);
    expect(ctx.backend.translateCalls).toEqual([]);
    expect(ctx.messages.edits).toEqual([]);
  });

  it("leaves the posts standing when the edit emptied the message", async () => {
    const ctx = makeContext({ redis: withPosts("fr") });

    await createMessageInvalidator(ctx).onUpdate(full("hola"), full("   "));

    expect(ctx.backend.translateCalls).toEqual([]);
    expect(ctx.messages.edits).toEqual([]);
    expect(ctx.redis.store.has(postsKey(MESSAGE_ID))).toBe(true);
  });

  it("forgets a post that is gone from the channel", async () => {
    const messages = makeFakeMessageEditor({ gone: [POSTED_MESSAGE_ID] });
    const ctx = makeContext({ redis: withPosts("fr", "de"), messages });

    await createMessageInvalidator(ctx).onUpdate(full("hola"), full("adios"));

    const remaining = JSON.parse(ctx.redis.store.get(postsKey(MESSAGE_ID))?.value ?? "[]") as unknown[];
    expect(remaining).toHaveLength(1);
    expect(ctx.messages.edits).toHaveLength(2);
  });

  it("keeps going when one post cannot be edited", async () => {
    const messages = makeFakeMessageEditor({ failing: [POSTED_MESSAGE_ID] });
    const ctx = makeContext({ redis: withPosts("fr", "de"), messages });

    await createMessageInvalidator(ctx).onUpdate(full("hola"), full("adios"));

    expect(ctx.messages.edits.map((edit) => edit.ref.target)).toEqual(["fr", "de"]);
    expect(ctx.log.entries.some((entry) => entry.level === "warn")).toBe(true);
  });

  it("leaves the posts stale rather than spending a budget it does not have", async () => {
    const ctx = makeContext({ redis: withPosts("fr"), rateLimiter: alwaysLimited("guild", 600) });

    await createMessageInvalidator(ctx).onUpdate(full("hola"), full("adios"));

    expect(ctx.backend.translateCalls).toEqual([]);
    expect(ctx.messages.edits).toEqual([]);
    expect(ctx.log.entries.some((entry) => entry.message.includes("rate limited"))).toBe(true);
  });

  it("charges the guild budget and not the editor's own", async () => {
    const ctx = makeContext({ redis: withPosts("fr") });

    await createMessageInvalidator(ctx).onUpdate(full("hola"), full("adios"));

    const counted = [...ctx.redis.store.keys()].filter((key) => key.startsWith("rl:"));
    expect(counted.every((key) => key.startsWith("rl:g:"))).toBe(true);
    expect(counted).toHaveLength(1);
  });
});
