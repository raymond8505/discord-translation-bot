import { describe, expect, it } from "vitest";
import { makeContext } from "./fixtures/context.fixture.js";
import { MESSAGE_ID } from "./fixtures/interaction.fixture.js";
import { CHANNEL_ID, POSTED_MESSAGE_ID } from "./fixtures/post.fixture.js";
import { publishTranslation } from "./publish.js";
import { sourceIdForText } from "./sourceId.js";
import { AUTO_SOURCE } from "./translate.js";

const posted = { id: POSTED_MESSAGE_ID, channelId: CHANNEL_ID };

describe("publishTranslation", () => {
  it("records where the translation landed, so an edit can find it", async () => {
    const ctx = makeContext();

    await publishTranslation(ctx, {
      sourceId: MESSAGE_ID,
      target: "fr",
      source: AUTO_SOURCE,
      post: async () => posted,
    });

    await expect(ctx.posts.list(MESSAGE_ID)).resolves.toEqual([
      { channelId: CHANNEL_ID, messageId: POSTED_MESSAGE_ID, target: "fr", source: AUTO_SOURCE },
    ]);
  });

  it("records nothing for free text, which has no message to be edited", async () => {
    const ctx = makeContext();
    const sourceId = sourceIdForText("hola");

    await publishTranslation(ctx, {
      sourceId,
      target: "fr",
      source: AUTO_SOURCE,
      post: async () => posted,
    });

    await expect(ctx.posts.list(sourceId)).resolves.toEqual([]);
    expect(ctx.redis.store.size).toBe(0);
  });

  it("keeps the post when the registry cannot be written", async () => {
    const ctx = makeContext();
    ctx.redis.set = async () => {
      throw new Error("ECONNREFUSED");
    };
    let posts = 0;

    await publishTranslation(ctx, {
      sourceId: MESSAGE_ID,
      target: "fr",
      source: AUTO_SOURCE,
      post: async () => {
        posts += 1;
        return posted;
      },
    });

    expect(posts).toBe(1);
    expect(ctx.log.entries[0]).toMatchObject({ level: "warn" });
  });

  it("lets a failed post through to the caller, which words it", async () => {
    const ctx = makeContext();

    await expect(
      publishTranslation(ctx, {
        sourceId: MESSAGE_ID,
        target: "fr",
        source: AUTO_SOURCE,
        post: () => Promise.reject(new Error("Missing Permissions")),
      }),
    ).rejects.toThrow("Missing Permissions");
  });
});
