import type { AppContext } from "./context.js";
import { sendDirect, type DirectRecipient } from "./dm.js";
import { isOperational, userMessageFor } from "./errors.js";
import { isFlagEmoji, languageForFlag } from "./flags.js";
import type { Translator } from "./i18n/index.js";
import { publishTranslation, type PostedMessage } from "./publish.js";
import {
  buildNoticeReply,
  buildTranslationReply,
  buildUnsupportedFlagReply,
  type ReplyPayload,
} from "./reply.js";
import { sourceIdForMessage } from "./sourceId.js";
import { postOptionsFor, type PostChannel, type PostOptions } from "./threads.js";
import { AUTO_SOURCE, translateWithCache } from "./translate.js";
import { showThinking } from "./typing.js";

/** The slice of `MessageReaction` every reaction on the message is read through. */
export interface ReactionSummary {
  readonly emoji: { readonly name: string | null };
  /** Null on a partial reaction; counted as the single reaction we know of. */
  readonly count: number | null;
}

/** The slice of `Message` / `PartialMessage` the trigger touches. */
export interface ReactedMessage {
  readonly id: string;
  readonly partial: boolean;
  readonly content: string | null;
  readonly author: { readonly id: string } | null;
  readonly client: { readonly user: { readonly id: string } | null };
  readonly guildId: string | null;
  readonly guild: { readonly preferredLocale: string } | null;
  readonly reactions: { readonly cache: ReadonlyMap<string, ReactionSummary> };
  readonly channel: PostChannel | null;
  fetch(): Promise<ReactedMessage>;
  reply(
    options: ReplyPayload & { allowedMentions: { repliedUser: boolean } } & PostOptions,
  ): Promise<PostedMessage>;
}

export interface FlagReaction extends ReactionSummary {
  readonly partial: boolean;
  readonly message: ReactedMessage;
  fetch(): Promise<FlagReaction>;
}

export interface ReactingUser extends DirectRecipient {
  readonly bot: boolean;
}

/** Every flag the bot can't serve shares one bucket: one DM per message, not one per flag. */
const UNSUPPORTED_BUCKET = "unsupported";

/**
 * The flag-reaction trigger: react 🇫🇷 to a message and the bot posts it in
 * French for the channel. The translation is public; every refusal is a DM to
 * whoever reacted. A reaction is not an interaction, so there is no ephemeral
 * reply to give, and a refusal concerns one person — the channel asked for
 * nothing and should not be told. A DM the user does not accept is dropped.
 *
 * A reaction carries no user locale (only interactions have one), so the flag is
 * read as one: 🇫🇷 is someone asking for French, whoever they are, and both the
 * post and the DM are worded in it. See `readerTranslator()`.
 *
 * Reactions that are not flags are ignored in silence; a flag the bot has no
 * language for is answered privately with the flags that would have worked.
 */
export async function handleFlagReaction(
  ctx: AppContext,
  reaction: FlagReaction,
  user: ReactingUser,
): Promise<void> {
  if (user.bot) return;
  if (!isFlagEmoji(reaction.emoji.name ?? "")) return;

  // Before the partial fetches below, which are themselves API calls: a partial
  // message still carries guildId, so nothing has to be fetched to decide this.
  // Silent when over budget, not a DM: a refusal per refused reaction is its
  // own flood, and the budget sits far above conversational use anyway.
  const limit = await ctx.rateLimiter.check({ userId: user.id, guildId: reaction.message.guildId });
  if (!limit.allowed) {
    ctx.log.warn(`flag reaction: rate limited (${limit.scope ?? "unknown"} budget); ignoring`);
    return;
  }

  let full: FlagReaction;
  let message: ReactedMessage;
  try {
    // Reactions on messages sent before boot arrive partial, text and all.
    full = reaction.partial ? await reaction.fetch() : reaction;
    message = full.message.partial ? await full.message.fetch() : full.message;
  } catch (err) {
    ctx.log.warn("flag reaction: reaction or message could not be fetched", err);
    return;
  }

  // The bot's own replies keep their text in an embed, so a flag on one could only ever say "no text".
  const self = message.client.user?.id;
  if (self !== undefined && message.author?.id === self) return;

  const guildLocale = message.guild?.preferredLocale ?? "";
  try {
    await translateForFlag(ctx, message, full.emoji.name ?? "", guildLocale, user);
  } catch (err) {
    if (isOperational(err)) ctx.log.warn("flag reaction: backend failure", err);
    else ctx.log.error("flag reaction: unexpected failure", err);
    // Worded here rather than before the try: by now the language set has been
    // fetched, so the flag resolves. It is still empty when the fetch itself is
    // what failed, and then the guild's locale is all anyone honestly has.
    const tr = readerTranslator(ctx, full.emoji.name ?? "", guildLocale);
    await sendDirect(ctx.log, user, buildNoticeReply(userMessageFor(err, tr)), "flag reaction");
  }
}

/**
 * Words what this trigger says in the language the flag asked for. Discord sends
 * a user locale only on interactions, so the alternative is the guild's
 * preferred locale — which answers a French reader in an English server in
 * English, the thing this replaces. A flag is a better signal than a locale
 * anyway: it says which language *this* answer is for.
 *
 * `peek()` rather than `get()` because the only caller is a failure path that
 * must not make a backend call of its own to report a backend call failing. A
 * flag the bot has no language for, and a language set that was never fetched,
 * both leave nothing to read the reader off: the guild's locale stands in.
 */
function readerTranslator(ctx: AppContext, emoji: string, guildLocale: string): Translator {
  const supported = ctx.languages.peek();
  const language = supported ? languageForFlag(emoji, supported) : null;
  return language ? ctx.i18n.forLanguage(language) : ctx.i18n.forLocale(guildLocale);
}

async function translateForFlag(
  ctx: AppContext,
  message: ReactedMessage,
  emoji: string,
  guildLocale: string,
  user: ReactingUser,
): Promise<void> {
  const supported = await ctx.languages.get();
  const target = languageForFlag(emoji, supported);
  if (alreadyAsked(message, target, supported)) return;

  // The set is in hand here, so the flag resolves for certain. A flag with no
  // language behind it names none, and that refusal falls back to the guild.
  const reader = target === null ? ctx.i18n.forLocale(guildLocale) : ctx.i18n.forLanguage(target);

  const sourceId = sourceIdForMessage(message.id);
  if (target === null) {
    await sendDirect(
      ctx.log,
      user,
      buildUnsupportedFlagReply({ flag: emoji, supported, tr: reader }),
      "flag reaction",
    );
    return;
  }

  const text = message.content ?? "";
  if (!text.trim()) {
    await sendDirect(ctx.log, user, buildNoticeReply(reader.t("translate.noText")), "flag reaction");
    return;
  }

  // From here on something is owed to the channel, so it is shown the bot
  // working. Stopped in a `finally` because a backend failure is answered by a
  // DM one frame up, and the bot must not still look busy while that goes out.
  const thinking = showThinking(ctx.log, message.channel);
  try {
    const outcome = await translateWithCache(ctx, { sourceId, text, target });
    await publishTranslation(ctx, {
      sourceId,
      target: outcome.target,
      source: AUTO_SOURCE,
      post: () =>
        replyQuietly(
          message,
          buildTranslationReply({ ...outcome, sourceId, source: AUTO_SOURCE, supported, tr: reader }),
        ),
    });
  } finally {
    thinking.stop();
  }
}

/**
 * Whether the message already carries a flag asking for the same thing. The
 * bucket is the language, not the emoji: 🇺🇸 on a message someone already
 * flagged 🇬🇧 wants the English translation that is already in the channel. The
 * reaction being handled is itself in the cache, so one ask is the normal case
 * and two means somebody got there first.
 */
function alreadyAsked(
  message: ReactedMessage,
  target: string | null,
  supported: ReadonlySet<string>,
): boolean {
  const bucket = target ?? UNSUPPORTED_BUCKET;
  let asks = 0;
  for (const other of message.reactions.cache.values()) {
    const name = other.emoji.name ?? "";
    if (!isFlagEmoji(name)) continue;
    if ((languageForFlag(name, supported) ?? UNSUPPORTED_BUCKET) !== bucket) continue;
    asks += other.count ?? 1;
    if (asks > 1) return true;
  }
  return false;
}

/** Replies without pinging the author; they wrote the message, they didn't ask for this. */
function replyQuietly(message: ReactedMessage, payload: ReplyPayload): Promise<PostedMessage> {
  return message.reply({
    ...payload,
    allowedMentions: { repliedUser: false },
    ...postOptionsFor(message.channel),
  });
}
