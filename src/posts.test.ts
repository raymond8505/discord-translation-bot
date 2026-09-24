import { describe, expect, it } from "vitest";
import { makeRecordingLogger } from "./fixtures/context.fixture.js";
import { MESSAGE_ID } from "./fixtures/interaction.fixture.js";
import { makePostRef, POSTED_MESSAGE_ID } from "./fixtures/post.fixture.js";
import { makeFakeRedis } from "./fixtures/redis.fixture.js";
import { createPostRegistry, postsKey } from "./posts.js";

const TTL = 900;
const OTHER_POST_ID = "456789012345678999";

function makeRegistry(seed: Record<string, string> = {}) {
  const redis = makeFakeRedis(seed);
  const log = makeRecordingLogger();
  return { redis, log, posts: createPostRegistry(redis, TTL, log) };
}

describe("createPostRegistry", () => {
  it("has nothing to say about a message it never posted about", async () => {
    const { posts } = makeRegistry();

    await expect(posts.list(MESSAGE_ID)).resolves.toEqual([]);
  });

  it("keeps every post made about one message, in the order they were made", async () => {
    const { posts } = makeRegistry();
    const french = makePostRef({ target: "fr" });
    const german = makePostRef({ target: "de", messageId: OTHER_POST_ID });

    await posts.record(MESSAGE_ID, french);
    await posts.record(MESSAGE_ID, german);

    await expect(posts.list(MESSAGE_ID)).resolves.toEqual([french, german]);
  });

  it("replaces a post recorded twice, so one edit never rewrites it twice", async () => {
    const { posts } = makeRegistry();

    await posts.record(MESSAGE_ID, makePostRef({ target: "fr" }));
    await posts.record(MESSAGE_ID, makePostRef({ target: "de" }));

    await expect(posts.list(MESSAGE_ID)).resolves.toEqual([makePostRef({ target: "de" })]);
  });

  it("bounds the entry, and extends it as long as the message keeps being translated", async () => {
    const { redis, posts } = makeRegistry();

    await posts.record(MESSAGE_ID, makePostRef());
    await posts.record(MESSAGE_ID, makePostRef({ messageId: OTHER_POST_ID }));

    expect(redis.store.get(postsKey(MESSAGE_ID))?.ex).toBe(TTL);
  });

  it("forgets one post and drops the whole entry once none are left", async () => {
    const { redis, posts } = makeRegistry();
    await posts.record(MESSAGE_ID, makePostRef());
    await posts.record(MESSAGE_ID, makePostRef({ messageId: OTHER_POST_ID }));

    await posts.forget(MESSAGE_ID, POSTED_MESSAGE_ID);
    await expect(posts.list(MESSAGE_ID)).resolves.toEqual([makePostRef({ messageId: OTHER_POST_ID })]);

    await posts.forget(MESSAGE_ID, OTHER_POST_ID);
    expect(redis.store.has(postsKey(MESSAGE_ID))).toBe(false);
  });

  it("does not write when there was nothing to forget", async () => {
    const { redis, posts } = makeRegistry();
    await posts.record(MESSAGE_ID, makePostRef());

    await posts.forget(MESSAGE_ID, OTHER_POST_ID);

    expect(redis.delCalls).toEqual([]);
  });

  it("drops everything known about a message", async () => {
    const { redis, posts } = makeRegistry();
    await posts.record(MESSAGE_ID, makePostRef());

    await posts.drop(MESSAGE_ID);

    expect(redis.store.has(postsKey(MESSAGE_ID))).toBe(false);
  });

  it("reads a corrupt entry as empty and says so", async () => {
    const { log, posts } = makeRegistry({ [postsKey(MESSAGE_ID)]: "{not json" });

    await expect(posts.list(MESSAGE_ID)).resolves.toEqual([]);
    expect(log.entries[0]).toMatchObject({ level: "warn" });
  });

  it("keeps only the entries that are really posts", async () => {
    const ref = makePostRef();
    const seed = JSON.stringify([ref, { messageId: OTHER_POST_ID }]);
    const { posts } = makeRegistry({ [postsKey(MESSAGE_ID)]: seed });

    await expect(posts.list(MESSAGE_ID)).resolves.toEqual([ref]);
  });
});
