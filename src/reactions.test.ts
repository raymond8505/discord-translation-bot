import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { BackendError } from "./backends/index.js";
import { makeFakeBackend } from "./fixtures/backend.fixture.js";
import { alwaysLimited, makeContext } from "./fixtures/context.fixture.js";
import { lastDmDescription } from "./fixtures/dm.fixture.js";
import { lastPostFlags, lastPostPayload, lastReplyDescription, lastReplyPayload, MESSAGE_ID, SPANISH_TEXT, typedBeforePosting, typingCount } from "./fixtures/interaction.fixture.js";
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

  it("shows the channel the bot working before the translation lands", async () => {
    const ctx = makeContext();
    const reaction = makeFlagReaction({ emoji: FLAGS.germany });

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    // A reaction has no interaction token, so the typing indicator is the only
    // sign anyone gets between the flag and the post.
    expect(typedBeforePosting(reaction)).toBe(true);
  });

  it("does not look busy over a refusal that never reaches the backend", async () => {
    const ctx = makeContext();
    const unsupported = makeFlagReaction({ emoji: FLAGS.cambodia });
    const noText = makeFlagReaction({ emoji: FLAGS.germany, content: "  " });

    await handleFlagReaction(ctx, unsupported, makeReactingUser());
    await handleFlagReaction(ctx, noText, makeReactingUser());

    expect(typingCount(unsupported)).toBe(0);
    expect(typingCount(noText)).toBe(0);
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
    const english = dm?.split("**English**\n")[1]?.split("\n")[0] ?? "";
    expect(english).toContain(
      [FLAGS.uk, FLAGS.usa, FLAGS.canada, FLAGS.australia, FLAGS.newZealand].join(" "),
    );
    expect(english).toContain(FLAGS.jamaica);
    // Label above, flags below.
    expect(dm).toContain(`**Japanese**\n${FLAGS.japan}`);
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
    // The flag, not the guild: 🇫🇷 in an English server is a French reader asking.
    const reaction = makeFlagReaction({ emoji: FLAGS.france, content: "" });

    await handleFlagReaction(ctx, reaction, user);

    expect(ctx.backend.translateCalls).toEqual([]);
    expect(lastDmDescription(user)).toBe(frenchMessages["translate.noText"]);
    expect(reaction.calls).toEqual([]);
  });

  it("words the post in the flag's language, not the guild's", async () => {
    const ctx = makeContext();
    const reaction = makeFlagReaction({ emoji: FLAGS.france });

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    // The guild is en-US and a reaction carries no user locale, so before this
    // the whole reply came back English however French the reader was.
    const payload = lastReplyPayload(reaction);
    expect(payload?.embeds[0]?.toJSON().title).toBe(`${frenchMessages["reply.title"]} → Français`);
    const menus = payload?.components.flatMap((row) => row.toJSON().components) ?? [];
    expect(menus.at(-1)?.placeholder).toContain(frenchMessages["menu.to"]);
    expect(menus.flatMap((menu) => menu.options ?? []).map((o) => o.label)).toContain("Allemand");
  });

  it("names the languages in a language it has no messages of its own for", async () => {
    const ctx = makeContext();
    const reaction = makeFlagReaction({ emoji: FLAGS.japan });

    await handleFlagReaction(ctx, reaction, makeReactingUser());

    // No Japanese message file, so the sentences stay English — but ICU can name
    // every language in Japanese, and those names are the menu.
    const payload = lastReplyPayload(reaction);
    expect(payload?.embeds[0]?.toJSON().title).toBe("Translation → 日本語");
    const options = payload?.components.flatMap((row) => row.toJSON().components[0]?.options ?? []) ?? [];
    expect(options.map((o) => o.label)).toContain("ドイツ語");
  });

  it("keeps the guild's wording for a flag that names no language", async () => {
    const ctx = makeContext();
    const user = makeReactingUser();
    // Nothing to read the reader's language off: the flag resolves to nothing.
    const reaction = makeFlagReaction({ emoji: FLAGS.cambodia, preferredLocale: "fr" });

    await handleFlagReaction(ctx, reaction, user);

    // Guild-locale wording, and its language names with it.
    expect(lastDmDescription(user)).toContain(FLAGS.cambodia);
    expect(lastDmDescription(user)).toContain("**Allemand**");
  });

  it("words a failure in the flag's language once the language set is warm", async () => {
    const ctx = makeContext({
      backend: makeFakeBackend({
        translate: () => {
          throw new Error("boom");
        },
      }),
    });
    // The failure notice is built before the trigger has awaited anything, so it
    // reads the memoized set; a bot that has served one request has it.
    await ctx.languages.get();
    const user = makeReactingUser();

    await handleFlagReaction(ctx, makeFlagReaction({ emoji: FLAGS.france }), user);

    expect(lastDmDescription(user)).toBe(frenchMessages["error.generic"]);
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
    // The channel was shown the bot working and then nothing landed in it: the
    // refusal is the reactor's alone.
    expect(typingCount(reaction)).toBe(1);
    expect(lastPostPayload(reaction)).toBeUndefined();
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
