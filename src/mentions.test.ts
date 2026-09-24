import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { BackendError } from "./backends/index.js";
import { makeFakeBackend } from "./fixtures/backend.fixture.js";
import { alwaysLimited, makeContext } from "./fixtures/context.fixture.js";
import { MESSAGE_ID, SPANISH_TEXT, lastPostFlags, lastReplyDescription, lastReplyPayload } from "./fixtures/interaction.fixture.js";
import { lastDmDescription } from "./fixtures/dm.fixture.js";
import { BOT_USER_ID, makeMentionMessage } from "./fixtures/message.fixture.js";
import { frenchMessages } from "./fixtures/messages.fixture.js";
import { handleMentionMessage } from "./mentions.js";

describe("handleMentionMessage", () => {
  it("translates the replied-to message into the guild's locale and replies without pinging", async () => {
    const ctx = makeContext();
    const message = makeMentionMessage({ preferredLocale: "de" });

    await handleMentionMessage(ctx, message);

    expect(ctx.backend.translateCalls).toEqual([{ text: SPANISH_TEXT, source: "auto", target: "de" }]);
    expect(lastReplyDescription(message)).toBe(`[de] ${SPANISH_TEXT}`);
    const payload = lastReplyPayload(message) as { allowedMentions?: { repliedUser: boolean } } | undefined;
    expect(payload?.allowedMentions).toEqual({ repliedUser: false });
    expect(message.hasOptions[0]).toEqual({ ignoreEveryone: true, ignoreRoles: true, ignoreRepliedUser: true });
  });

  it("records the post against the message it translated, not the mention", async () => {
    const ctx = makeContext();

    await handleMentionMessage(ctx, makeMentionMessage({ preferredLocale: "de" }));

    // An edit to the parent is what this post has to follow.
    await expect(ctx.posts.list(MESSAGE_ID)).resolves.toMatchObject([{ target: "de", source: "auto" }]);
  });

  it("reads a language hint from the tagging message", async () => {
    const ctx = makeContext();

    await handleMentionMessage(ctx, makeMentionMessage({ content: `<@${BOT_USER_ID}> to japanese` }));
    await handleMentionMessage(ctx, makeMentionMessage({ content: `fr <@!${BOT_USER_ID}>` }));

    expect(ctx.backend.translateCalls.map((c) => c.target)).toEqual(["ja", "fr"]);
  });

  it("forces the source with the source:target form", async () => {
    const ctx = makeContext();

    // Three distinct (source, target) pairs over one text: the content-keyed
    // cache would serve a repeat rather than let it reach the fake backend.
    await handleMentionMessage(ctx, makeMentionMessage({ content: `<@${BOT_USER_ID}> fr:en` }));
    await handleMentionMessage(ctx, makeMentionMessage({ content: `<@${BOT_USER_ID}> fr:`, preferredLocale: "de" }));
    await handleMentionMessage(ctx, makeMentionMessage({ content: `<@${BOT_USER_ID}> :ja` }));

    expect(ctx.backend.translateCalls.map((c) => [c.source, c.target])).toEqual([
      ["fr", "en"],
      ["fr", "de"],
      ["auto", "ja"],
    ]);
  });

  it("rejects an unknown language in the colon form but tolerates free chat", async () => {
    const ctx = makeContext();

    const strict = makeMentionMessage({ content: `<@${BOT_USER_ID}> klingon:en` });
    await handleMentionMessage(ctx, strict);
    expect(lastDmDescription(strict.author)).toContain("klingon");
    expect(strict.calls).toEqual([]);

    const chatty = makeMentionMessage({ content: `<@${BOT_USER_ID}> please` });
    await handleMentionMessage(ctx, chatty);
    expect(lastReplyDescription(chatty)).toBe(`[en] ${SPANISH_TEXT}`);

    expect(ctx.backend.translateCalls).toHaveLength(1);
  });

  it("does nothing for bot authors, non-mentions, or before the client is ready", async () => {
    const ctx = makeContext();
    const cases = [
      makeMentionMessage({ authorIsBot: true }),
      makeMentionMessage({ mentionsBot: false }),
      makeMentionMessage({ clientReady: false }),
    ];

    for (const message of cases) await handleMentionMessage(ctx, message);

    expect(cases.every((m) => m.calls.length === 0)).toBe(true);
    expect(ctx.backend.translateCalls).toHaveLength(0);
  });

  it("explains the trigger privately when mentioned outside a reply", async () => {
    const ctx = makeContext();
    const message = makeMentionMessage({ parent: null });

    await handleMentionMessage(ctx, message);

    expect(lastDmDescription(message.author)).toMatch(/Reply to the message/);
    // The channel is told nothing: nobody there asked for this.
    expect(message.calls).toEqual([]);
  });

  it("drops a refusal the author will not accept rather than posting it", async () => {
    const ctx = makeContext();
    const message = makeMentionMessage({ parent: null, dmsClosed: true });

    await handleMentionMessage(ctx, message);

    expect(message.author.dms).toHaveLength(1);
    expect(message.calls).toEqual([]);
    expect(ctx.log.entries.some((e) => e.level === "warn")).toBe(true);
  });

  it("speaks the guild's preferred language and reads hints in it", async () => {
    const ctx = makeContext();

    const outsideReply = makeMentionMessage({ parent: null, preferredLocale: "fr" });
    await handleMentionMessage(ctx, outsideReply);
    expect(lastDmDescription(outsideReply.author)).toBe(frenchMessages["mention.hint"]);

    const hinted = makeMentionMessage({ content: `<@${BOT_USER_ID}> allemand`, preferredLocale: "fr" });
    await handleMentionMessage(ctx, hinted);
    expect(ctx.backend.translateCalls.map((c) => c.target)).toEqual(["de"]);
  });

  it("notices an unreadable or empty parent", async () => {
    const ctx = makeContext();

    const unreadable = makeMentionMessage({ parentUnreadable: true });
    await handleMentionMessage(ctx, unreadable);
    expect(lastDmDescription(unreadable.author)).toMatch(/couldn't read/);

    const empty = makeMentionMessage({ parent: { id: MESSAGE_ID, content: "" } });
    await handleMentionMessage(ctx, empty);
    expect(lastDmDescription(empty.author)).toMatch(/no text/);
  });

  it("words backend failures privately instead of throwing", async () => {
    const backend = makeFakeBackend({
      translate: async () => {
        throw new BackendError("network", "down");
      },
    });
    const ctx = makeContext({ backend });
    const message = makeMentionMessage();

    await expect(handleMentionMessage(ctx, message)).resolves.toBeUndefined();

    expect(lastDmDescription(message.author)).toMatch(/still starting up/);
    expect(message.calls).toEqual([]);
    expect(ctx.log.entries.some((e) => e.level === "warn")).toBe(true);
  });

  it("stays silent when rate limited rather than replying publicly", async () => {
    const ctx = makeContext({ rateLimiter: alwaysLimited() });
    const message = makeMentionMessage();

    await handleMentionMessage(ctx, message);

    // A public "slow down" per refused request doubles the flood it is meant
    // to stop, so the trigger answers nothing and only the log records it.
    expect(message.calls).toEqual([]);
    expect(ctx.backend.translateCalls).toEqual([]);
    expect(ctx.log.entries.some((e) => e.message.includes("rate limited"))).toBe(true);
  });

  it("posts silently into a thread, and normally outside one", async () => {
    const ctx = makeContext();

    const thread = makeMentionMessage({ content: `<@${BOT_USER_ID}> ja`, inThread: true });
    await handleMentionMessage(ctx, thread);
    expect(lastPostFlags(thread)).toBe(MessageFlags.SuppressNotifications);

    const channel = makeMentionMessage({ content: `<@${BOT_USER_ID}> de` });
    await handleMentionMessage(ctx, channel);
    expect(lastPostFlags(channel)).toBeUndefined();
  });

});
