import { describe, expect, it } from "vitest";
import { BackendError } from "./backends/index.js";
import { makeFakeBackend } from "./fixtures/backend.fixture.js";
import { alwaysLimited, makeContext } from "./fixtures/context.fixture.js";
import { lastReplyDescription, lastReplyPayload, MESSAGE_ID, SPANISH_TEXT } from "./fixtures/interaction.fixture.js";
import { BOT_USER_ID } from "./fixtures/message.fixture.js";
import { frenchMessages } from "./fixtures/messages.fixture.js";
import { FLAGS, makeFlagReaction, makeReactingUser, NON_FLAGS } from "./fixtures/reaction.fixture.js";
import { handleFlagReaction } from "./reactions.js";

/** The reply payload's mention rules, which `ReplyPayload` alone doesn't carry. */
function allowedMentions(reaction: Parameters<typeof lastReplyPayload>[0]) {
  return (lastReplyPayload(reaction) as { allowedMentions?: { repliedUser: boolean } } | undefined)?.allowedMentions;
}

describe("handleFlagReaction", () => {
  it("translates into the flag's language and replies publicly without pinging", async () => {
    const ctx = makeContext();
    const reaction = makeFlagReaction({ emoji: FLAGS.germany });

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    expect(ctx.backend.translateCalls).toEqual([{ text: SPANISH_TEXT, source: "auto", target: "de" }]);
    expect(lastReplyDescription(reaction)).toBe(`[de] ${SPANISH_TEXT}`);
    expect(allowedMentions(reaction)).toEqual({ repliedUser: false });
    expect(lastReplyPayload(reaction)?.components.length).toBeGreaterThan(0);
  });

  it("reads the region behind the flag, not the country", async () => {
    const ctx = makeContext();
    const canadian = makeFlagReaction({ emoji: FLAGS.canada });
    const brazilian = makeFlagReaction({ emoji: FLAGS.brazil });

    await handleFlagReaction(ctx, canadian, makeReactingUser());
    await handleFlagReaction(ctx, brazilian, makeReactingUser());

    expect(ctx.backend.translateCalls.map((call) => call.target)).toEqual(["en", "pt-BR"]);
  });

  it("ignores reactions that mean nothing to it", async () => {
    const ctx = makeContext();
    const emoji = makeFlagReaction({ emoji: NON_FLAGS.thumbsUp });
    const fromBot = makeFlagReaction();
    const onOwnPost = makeFlagReaction({ authorId: BOT_USER_ID });

    await handleFlagReaction(ctx, emoji, makeReactingUser());
    await handleFlagReaction(ctx, fromBot, makeReactingUser(true));
    await handleFlagReaction(ctx, onOwnPost, makeReactingUser());

    expect(ctx.backend.translateCalls).toEqual([]);
    for (const reaction of [emoji, fromBot, onOwnPost]) expect(reaction.calls).toEqual([]);
  });

  it("fetches a partial reaction and a partial message before reading the text", async () => {
    const ctx = makeContext();
    const reaction = makeFlagReaction({ partial: true, messagePartial: true });

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    expect(reaction.fetchCalls).toEqual(["reaction", "message"]);
    expect(lastReplyDescription(reaction)).toBe(`[fr] ${SPANISH_TEXT}`);
  });

  it("gives up quietly when the message is gone by the time it fetches", async () => {
    const ctx = makeContext();
    const reaction = makeFlagReaction({ partial: true, unreadable: true });

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    expect(reaction.calls).toEqual([]);
    expect(ctx.log.entries[0]?.level).toBe("warn");
  });

  it("treats flags that share a language as one request", async () => {
    const ctx = makeContext();
    const second = makeFlagReaction({ emoji: FLAGS.usa, siblings: { [FLAGS.uk]: 1 } });
    const twice = makeFlagReaction({ emoji: FLAGS.germany, count: 2 });

    await handleFlagReaction(ctx, second, makeReactingUser());
    await handleFlagReaction(ctx, twice, makeReactingUser());

    expect(ctx.backend.translateCalls).toEqual([]);
    expect(second.calls).toEqual([]);
    expect(twice.calls).toEqual([]);
  });

  it("still answers a flag for a language nobody has asked for yet", async () => {
    const ctx = makeContext();
    const reaction = makeFlagReaction({ emoji: FLAGS.france, siblings: { [FLAGS.uk]: 3 } });

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    expect(ctx.backend.translateCalls).toEqual([{ text: SPANISH_TEXT, source: "auto", target: "fr" }]);
  });

  it("offers the target menus when the flag names no language it can serve", async () => {
    const ctx = makeContext();
    const reaction = makeFlagReaction({ emoji: FLAGS.cambodia });

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    expect(ctx.backend.translateCalls).toEqual([]);
    expect(lastReplyDescription(reaction)).toContain(FLAGS.cambodia);
    const menu = lastReplyPayload(reaction)?.components[0]?.toJSON().components[0];
    expect(menu?.custom_id).toBe(`lang:t:0:auto:${MESSAGE_ID}`);
  });

  it("posts one menu per message however many flags it can't serve", async () => {
    const ctx = makeContext();
    // Croatian is a table language this backend never loaded; both flags land in the same bucket.
    const reaction = makeFlagReaction({ emoji: FLAGS.cambodia, siblings: { [FLAGS.croatia]: 1 } });

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    expect(reaction.calls).toEqual([]);
  });

  it("says so when the message has no text to translate", async () => {
    const ctx = makeContext();
    const reaction = makeFlagReaction({ content: "", preferredLocale: "fr" });

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    expect(ctx.backend.translateCalls).toEqual([]);
    expect(lastReplyDescription(reaction)).toBe(frenchMessages["translate.noText"]);
  });

  it("words a backend failure for the guild and logs it as operational", async () => {
    const ctx = makeContext({
      backend: makeFakeBackend({
        translate: () => {
          throw new BackendError("network", "down");
        },
      }),
    });
    const reaction = makeFlagReaction();

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    expect(lastReplyDescription(reaction)).toMatch(/still starting up/);
    expect(ctx.log.entries.map((entry) => entry.level)).toContain("warn");
    expect(ctx.log.entries.some((entry) => entry.level === "error")).toBe(false);
  });

  it("stays silent when rate limited, before fetching anything", async () => {
    const ctx = makeContext({ rateLimiter: alwaysLimited() });
    const reaction = makeFlagReaction({ partial: true, messagePartial: true });

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    // Refused early enough that neither partial is fetched: a partial message
    // already carries the guildId the decision needs.
    expect(reaction.fetchCalls).toEqual([]);
    expect(reaction.message.calls).toEqual([]);
    expect(ctx.backend.translateCalls).toEqual([]);
  });
});
