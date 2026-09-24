import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { BackendError } from "./backends/index.js";
import { makeFakeBackend } from "./fixtures/backend.fixture.js";
import { alwaysLimited, makeContext } from "./fixtures/context.fixture.js";
import { lastDmDescription } from "./fixtures/dm.fixture.js";
import { lastPostFlags, lastReplyDescription, lastReplyPayload, MESSAGE_ID, SPANISH_TEXT } from "./fixtures/interaction.fixture.js";
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

  it("records the post so an edit to the message reaches it", async () => {
    const ctx = makeContext();

    await handleFlagReaction(ctx, makeFlagReaction({ emoji: FLAGS.germany }), makeReactingUser());

    await expect(ctx.posts.list(MESSAGE_ID)).resolves.toMatchObject([{ target: "de", source: "auto" }]);
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

  it("privately lists the flags that would have worked, and tells the channel nothing", async () => {
    const ctx = makeContext();
    const user = makeReactingUser();
    const reaction = makeFlagReaction({ emoji: FLAGS.cambodia });

    await handleFlagReaction(ctx, reaction, user);

    expect(ctx.backend.translateCalls).toEqual([]);
    const dm = lastDmDescription(user);
    expect(dm).toContain(FLAGS.cambodia);
    // Every flag that works, not just the first: someone deciding what to react
    // with needs to know their own country's flag is one of them.
    expect(dm).toContain(
      [FLAGS.uk, FLAGS.usa, FLAGS.canada, FLAGS.australia, FLAGS.newZealand, FLAGS.ireland, FLAGS.southAfrica]
        .join(" ") + " English",
    );
    expect(dm).toContain(`${FLAGS.japan} Japanese`);
    expect(dm).toMatch(/server admin/);
    // No menus: a pick made in a DM would post the translation into the DM.
    expect(user.dms[0]?.components).toEqual([]);
    expect(reaction.calls).toEqual([]);
  });

  it("drops a refusal the reactor will not accept rather than posting it", async () => {
    const ctx = makeContext();
    const user = makeReactingUser(false, undefined, { closed: true });
    const reaction = makeFlagReaction({ emoji: FLAGS.cambodia });

    await handleFlagReaction(ctx, reaction, user);

    expect(user.dms).toHaveLength(1);
    expect(reaction.calls).toEqual([]);
    expect(ctx.log.entries.some((e) => e.level === "warn")).toBe(true);
  });

  it("sends one refusal per message however many flags it can't serve", async () => {
    const ctx = makeContext();
    // Croatian is a table language this backend never loaded; both flags land in the same bucket.
    const reaction = makeFlagReaction({ emoji: FLAGS.cambodia, siblings: { [FLAGS.croatia]: 1 } });

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    expect(reaction.calls).toEqual([]);
  });

  it("says so privately when the message has no text to translate", async () => {
    const ctx = makeContext();
    const user = makeReactingUser();
    const reaction = makeFlagReaction({ content: "", preferredLocale: "fr" });

    await handleFlagReaction(ctx, reaction, user);

    expect(ctx.backend.translateCalls).toEqual([]);
    // The guild locale, not the reactor's: a reaction carries no user locale.
    expect(lastDmDescription(user)).toBe(frenchMessages["translate.noText"]);
    expect(reaction.calls).toEqual([]);
  });

  it("words a backend failure for the guild and logs it as operational", async () => {
    const ctx = makeContext({
      backend: makeFakeBackend({
        translate: () => {
          throw new BackendError("network", "down");
        },
      }),
    });
    const user = makeReactingUser();
    const reaction = makeFlagReaction();

    await handleFlagReaction(ctx, reaction, user);

    expect(lastDmDescription(user)).toMatch(/still starting up/);
    expect(reaction.calls).toEqual([]);
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

  it("posts silently into a thread, and normally outside one", async () => {
    const ctx = makeContext();

    const thread = makeFlagReaction({ emoji: FLAGS.japan, inThread: true });
    await handleFlagReaction(ctx, thread, makeReactingUser());
    expect(lastPostFlags(thread)).toBe(MessageFlags.SuppressNotifications);

    const channel = makeFlagReaction({ emoji: FLAGS.germany });
    await handleFlagReaction(ctx, channel, makeReactingUser());
    expect(lastPostFlags(channel)).toBeUndefined();
  });

});
