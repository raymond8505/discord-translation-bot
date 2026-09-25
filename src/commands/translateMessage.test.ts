import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { sourceKey, translationKey } from "../cache.js";
import { lastPostFlags } from "../fixtures/interaction.fixture.js";
import { alwaysLimited, makeContext } from "../fixtures/context.fixture.js";
import {
  MESSAGE_ID,
  SPANISH_TEXT,
  lastPostDescription,
  lastPostPayload,
  lastReplyDescription,
  typedBeforePosting,
  makeMessageContextInteraction,
} from "../fixtures/interaction.fixture.js";
import { frenchMessages } from "../fixtures/messages.fixture.js";
import { contentHash } from "../sourceId.js";
import { handleTranslateMessage, translateMessageCommand } from "./translateMessage.js";

describe("translateMessageCommand", () => {
  it("is a message context-menu command", () => {
    expect(translateMessageCommand.toJSON()).toMatchObject({ name: "Translate Message", type: 3 });
  });
});

describe("handleTranslateMessage", () => {
  it("defers ephemerally and posts the translation as a reply to the message", async () => {
    const ctx = makeContext();
    const interaction = makeMessageContextInteraction({ locale: "fr" });

    await handleTranslateMessage(ctx, interaction);

    expect(interaction.calls[0]).toEqual({ method: "deferReply", payload: { flags: MessageFlags.Ephemeral } });
    expect(ctx.backend.translateCalls).toEqual([{ text: SPANISH_TEXT, source: "auto", target: "fr" }]);
    expect(lastPostDescription(interaction)).toBe(`[fr] ${SPANISH_TEXT}`);
    // The invoker sees the defer; the channel sees the bot working.
    expect(typedBeforePosting(interaction)).toBe(true);
    // The author wrote the message; they did not ask to be pinged about it.
    expect(lastPostPayload(interaction)).toMatchObject({ allowedMentions: { repliedUser: false } });
  });

  it("tells only the invoker that it posted, and records where", async () => {
    const ctx = makeContext();
    const interaction = makeMessageContextInteraction({ id: MESSAGE_ID, locale: "fr" });

    await handleTranslateMessage(ctx, interaction);

    expect(lastReplyDescription(interaction)).toBe(frenchMessages["reply.posted"]);
    await expect(ctx.posts.list(MESSAGE_ID)).resolves.toMatchObject([{ target: "fr", source: "auto" }]);
  });

  it("caches the translation by content and the source text by message id", async () => {
    const ctx = makeContext();

    await handleTranslateMessage(ctx, makeMessageContextInteraction({ id: MESSAGE_ID, locale: "de" }));

    expect(ctx.redis.store.has(translationKey(contentHash(SPANISH_TEXT), "auto", "de"))).toBe(true);
    expect(ctx.redis.store.get(sourceKey(MESSAGE_ID))?.value).toBe(SPANISH_TEXT);
  });

  it("replies with a notice when the message has no text", async () => {
    const ctx = makeContext();
    const interaction = makeMessageContextInteraction({ content: "", locale: "en-US" });

    await handleTranslateMessage(ctx, interaction);

    expect(lastReplyDescription(interaction)).toBe("That message has no text to translate.");
    expect(ctx.backend.translateCalls).toHaveLength(0);
  });

  it("words the notice in the user's Discord language", async () => {
    const ctx = makeContext();
    const interaction = makeMessageContextInteraction({ content: "", locale: "fr" });

    await handleTranslateMessage(ctx, interaction);

    expect(lastReplyDescription(interaction)).toBe(frenchMessages["translate.noText"]);
  });

  it("refuses with an ephemeral notice when rate limited", async () => {
    const ctx = makeContext({ rateLimiter: alwaysLimited("user", 17) });
    const interaction = makeMessageContextInteraction();

    await handleTranslateMessage(ctx, interaction);

    expect(lastReplyDescription(interaction)).toContain("17");
    expect(ctx.backend.translateCalls).toEqual([]);
  });

  it("posts silently into a thread, and normally outside one", async () => {
    const ctx = makeContext();

    const thread = makeMessageContextInteraction({ locale: "ja", inThread: true });
    await handleTranslateMessage(ctx, thread);
    expect(lastPostFlags(thread)).toBe(MessageFlags.SuppressNotifications);

    const channel = makeMessageContextInteraction({ locale: "de" });
    await handleTranslateMessage(ctx, channel);
    expect(lastPostFlags(channel)).toBeUndefined();
  });

});
