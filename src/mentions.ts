import type { MessageMentionsHasOptions } from "discord.js";
import type { AppContext } from "./context.js";
import { isOperational, userMessageFor } from "./errors.js";
import type { Translator } from "./i18n/index.js";
import { parseLanguageSpec, resolveTarget } from "./locale.js";
import { buildNoticeReply, buildTranslationReply, type ReplyPayload } from "./reply.js";
import { sourceIdForMessage } from "./sourceId.js";
import { AUTO_SOURCE, translateWithCache } from "./translate.js";

/** The slice of `Message` the mention trigger touches. */
export interface MentionMessage {
  readonly content: string;
  readonly author: { readonly bot: boolean };
  readonly client: { readonly user: { readonly id: string } | null };
  readonly guild: { readonly preferredLocale: string } | null;
  readonly reference: { readonly messageId: string | undefined } | null;
  readonly mentions: { has(userId: string, options?: MessageMentionsHasOptions): boolean };
  fetchReference(): Promise<{ readonly id: string; readonly content: string }>;
  reply(options: ReplyPayload & { allowedMentions: { repliedUser: boolean } }): Promise<unknown>;
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
 * translates the replied-to message for everyone in the channel. Public by
 * necessity (only interactions can be ephemeral); the menus on the reply
 * answer each clicker privately. A message carries no user locale, so the
 * reply is worded in the guild's preferred language.
 */
export async function handleMentionMessage(ctx: AppContext, message: MentionMessage): Promise<void> {
  if (message.author.bot) return;
  const bot = message.client.user;
  if (!bot || !message.mentions.has(bot.id, MENTION_OPTIONS)) return;

  const tr = ctx.i18n.forLocale(message.guild?.preferredLocale ?? "");
  try {
    await translateParent(ctx, message, tr);
  } catch (err) {
    if (isOperational(err)) ctx.log.warn("mention trigger: backend failure", err);
    else ctx.log.error("mention trigger: unexpected failure", err);
    await replyQuietly(message, buildNoticeReply(userMessageFor(err, tr)));
  }
}

async function translateParent(ctx: AppContext, message: MentionMessage, tr: Translator): Promise<void> {
  if (!message.reference?.messageId) {
    await replyQuietly(message, buildNoticeReply(tr.t("mention.hint")));
    return;
  }

  let parent: { id: string; content: string };
  try {
    parent = await message.fetchReference();
  } catch {
    await replyQuietly(message, buildNoticeReply(tr.t("mention.unreadable")));
    return;
  }
  if (!parent.content.trim()) {
    await replyQuietly(message, buildNoticeReply(tr.t("translate.noText")));
    return;
  }

  const supported = await ctx.languages.get();
  const hint = message.content.replace(USER_MENTION, " ");
  const spec = parseLanguageSpec(hint, supported, tr.language);
  // Free chat around the mention is fine; only the explicit colon form is strict.
  if (hint.includes(":") && spec.unresolved.length > 0) {
    await replyQuietly(
      message,
      buildNoticeReply(tr.t("translate.unknownLanguage", { name: spec.unresolved[0] ?? "" })),
    );
    return;
  }
  const target = spec.target ?? resolveTarget(message.guild?.preferredLocale ?? "", supported);

  const sourceId = sourceIdForMessage(parent.id);
  const outcome = await translateWithCache(ctx, {
    sourceId,
    text: parent.content,
    target,
    source: spec.source ?? undefined,
  });
  await replyQuietly(
    message,
    buildTranslationReply({ ...outcome, sourceId, source: spec.source ?? AUTO_SOURCE, supported, tr }),
  );
}

/** Replies without pinging the author again; they just posted and are watching. */
function replyQuietly(message: MentionMessage, payload: ReplyPayload): Promise<unknown> {
  return message.reply({ ...payload, allowedMentions: { repliedUser: false } });
}
