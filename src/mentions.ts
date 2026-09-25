import type { MessageMentionsHasOptions } from "discord.js";
import type { AppContext } from "./context.js";
import { sendDirect, type DirectRecipient } from "./dm.js";
import { isOperational, userMessageFor } from "./errors.js";
import type { Translator } from "./i18n/index.js";
import { parseLanguageSpec, resolveTarget } from "./locale.js";
import { publishTranslation, type PostedMessage } from "./publish.js";
import { buildNoticeReply, buildTranslationReply, type ReplyPayload } from "./reply.js";
import { sourceIdForMessage } from "./sourceId.js";
import { postOptionsFor, type PostChannel, type PostOptions } from "./threads.js";
import { AUTO_SOURCE, translateWithCache } from "./translate.js";
import { showThinking } from "./typing.js";

/** The slice of `Message` the mention trigger touches. */
export interface MentionMessage {
  readonly content: string;
  readonly author: DirectRecipient & { readonly bot: boolean };
  readonly client: { readonly user: { readonly id: string } | null };
  readonly guildId: string | null;
  readonly guild: { readonly preferredLocale: string } | null;
  readonly reference: { readonly messageId: string | undefined } | null;
  readonly channel: PostChannel | null;
  readonly mentions: { has(userId: string, options?: MessageMentionsHasOptions): boolean };
  fetchReference(): Promise<{ readonly id: string; readonly content: string }>;
  reply(
    options: ReplyPayload & { allowedMentions: { repliedUser: boolean } } & PostOptions,
  ): Promise<PostedMessage>;
}

/**
 * Replying to a bot message auto-mentions the bot and @everyone resolves to
 * every user, so both are ignored: only a direct @mention counts.
 */
const MENTION_OPTIONS: MessageMentionsHasOptions = {
  ignoreEveryone: true,
  ignoreRoles: true,
  ignoreRepliedUser: true,
};

const USER_MENTION = /<@!?\d+>/g;

/**
 * The reply-and-mention trigger: `@bot [language]` posted as a reply
 * translates the replied-to message for everyone in the channel.
 *
 * The translation is public; every refusal is a DM to whoever mentioned the
 * bot. A message is not an interaction, so there is no ephemeral reply to
 * give, and a refusal concerns one person — the channel asked for nothing and
 * should not be told. A DM the user does not accept is dropped.
 *
 * A message carries no user locale (only interactions have one). A hint that
 * names a target says which language the answer is for, so the post — and the
 * refusals raised after it is parsed — are worded in it; a bare `@bot` names
 * nothing, and falls back to the guild's preferred language as before.
 */
export async function handleMentionMessage(ctx: AppContext, message: MentionMessage): Promise<void> {
  if (message.author.bot) return;
  const bot = message.client.user;
  if (!bot || !message.mentions.has(bot.id, MENTION_OPTIONS)) return;

  // Over-limit is silent here, not a notice. This trigger's replies are public,
  // so answering every refused request would turn one person's spam into two
  // messages instead of none — the notice becomes the flood it is meant to stop.
  // The budget is far above conversational use, so silence only ever meets abuse.
  const limit = await ctx.rateLimiter.check({ userId: message.author.id, guildId: message.guildId });
  if (!limit.allowed) {
    ctx.log.warn(`mention trigger: rate limited (${limit.scope ?? "unknown"} budget); ignoring`);
    return;
  }

  const tr = ctx.i18n.forLocale(message.guild?.preferredLocale ?? "");
  try {
    await translateParent(ctx, message, tr);
  } catch (err) {
    if (isOperational(err)) ctx.log.warn("mention trigger: backend failure", err);
    else ctx.log.error("mention trigger: unexpected failure", err);
    await refuse(ctx, message, buildNoticeReply(userMessageFor(err, tr)));
  }
}

async function translateParent(ctx: AppContext, message: MentionMessage, tr: Translator): Promise<void> {
  if (!message.reference?.messageId) {
    await refuse(ctx, message, buildNoticeReply(tr.t("mention.hint")));
    return;
  }

  let parent: { id: string; content: string };
  try {
    parent = await message.fetchReference();
  } catch {
    await refuse(ctx, message, buildNoticeReply(tr.t("mention.unreadable")));
    return;
  }
  if (!parent.content.trim()) {
    await refuse(ctx, message, buildNoticeReply(tr.t("translate.noText")));
    return;
  }

  const supported = await ctx.languages.get();
  const hint = message.content.replace(USER_MENTION, " ");
  const spec = parseLanguageSpec(hint, supported, tr.displayLanguage);
  // Free chat around the mention is fine; only the explicit colon form is strict.
  if (hint.includes(":") && spec.unresolved.length > 0) {
    await refuse(
      ctx,
      message,
      buildNoticeReply(tr.t("translate.unknownLanguage", { name: spec.unresolved[0] ?? "" })),
    );
    return;
  }
  const target = spec.target ?? resolveTarget(message.guild?.preferredLocale ?? "", supported);
  // Only an explicit hint tells us anything about the reader. Without one the
  // guild's translator already words itself in the guild's language, and it says
  // more than the target derived from that same locale would (a guild locale the
  // backend cannot translate into still names languages in itself).
  const reader = spec.target ? ctx.i18n.forLanguage(spec.target) : tr;

  const sourceId = sourceIdForMessage(parent.id);
  const source = spec.source ?? AUTO_SOURCE;
  // From here on something is owed to the channel, so it is shown the bot
  // working. Stopped in a `finally` because a backend failure is answered by a
  // DM one frame up, and the bot must not still look busy while that goes out.
  const thinking = showThinking(ctx.log, message.channel);
  try {
    const outcome = await translateWithCache(ctx, {
      sourceId,
      text: parent.content,
      target,
      source: spec.source ?? undefined,
    });
    // Recorded against the message that was *translated*, not the mention that
    // asked: an edit to the parent is what this post has to follow.
    await publishTranslation(ctx, {
      sourceId,
      target: outcome.target,
      source,
      post: () =>
        replyQuietly(
          message,
          buildTranslationReply({ ...outcome, sourceId, source, supported, tr: reader }),
        ),
    });
  } finally {
    thinking.stop();
  }
}

/** A refusal goes to the person who asked, never to the channel. */
function refuse(ctx: AppContext, message: MentionMessage, payload: ReplyPayload): Promise<boolean> {
  return sendDirect(ctx.log, message.author, payload, "mention trigger");
}

/** Replies without pinging the author again; they just posted and are watching. */
function replyQuietly(message: MentionMessage, payload: ReplyPayload): Promise<PostedMessage> {
  return message.reply({
    ...payload,
    allowedMentions: { repliedUser: false },
    ...postOptionsFor(message.channel),
  });
}
