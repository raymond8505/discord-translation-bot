import { MessageFlags } from "discord.js";
import type { AppContext } from "../context.js";
import { rateLimitMessageFor } from "../errors.js";
import { publishTranslation, type PostedMessage } from "../publish.js";
import { buildNoticeReply, buildTranslationReply, type ReplyPayload } from "../reply.js";
import { isMessageSourceId } from "../sourceId.js";
import { postOptionsFor, type PostChannel, type PostOptions } from "../threads.js";
import { AUTO_SOURCE, translateWithCache } from "../translate.js";
import { showThinking } from "../typing.js";
import { AUTO_VALUE, parseSelectCustomId } from "./customId.js";

/** The slice of `StringSelectMenuInteraction` the handler touches. */
export interface LanguageSelectInteraction {
  readonly locale: string;
  readonly user: { readonly id: string };
  readonly guildId: string | null;
  readonly customId: string;
  readonly values: readonly string[];
  /** `send` is absent on the one channel kind that cannot be posted to (a partial group DM). */
  readonly channel:
    | (PostChannel & {
        readonly messages: { fetch(id: string): Promise<{ readonly content: string }> };
        send?(payload: ReplyPayload & PostOptions): Promise<PostedMessage>;
      })
    | null;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
}

/**
 * Re-translates after a menu pick. A source menu forces (or un-forces) the
 * source and keeps the target; a target menu keeps the source.
 *
 * The new translation is posted to the channel, like every other translation:
 * a pick is someone saying the room needs this in another language too. The
 * post the menu sits on stays as it is — it is a translation someone else
 * asked for, and it follows its own source message on its own.
 */
export async function handleLanguageSelect(
  ctx: AppContext,
  interaction: LanguageSelectInteraction,
): Promise<void> {
  const parsed = parseSelectCustomId(interaction.customId);
  if (!parsed) {
    ctx.log.warn(`ignoring select with unrecognised customId ${interaction.customId}`);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tr = ctx.i18n.forLocale(interaction.locale);

  // A menu pick re-translates, so it costs the backend exactly what a command
  // does. Menus on a public reply are clickable by anyone in the channel, which
  // makes this the cheapest surface to hammer and the one most worth counting.
  const limit = await ctx.rateLimiter.check({ userId: interaction.user.id, guildId: interaction.guildId });
  if (!limit.allowed) {
    await interaction.editReply(buildNoticeReply(rateLimitMessageFor(limit, tr)));
    return;
  }

  const picked = interaction.values[0];
  if (!picked) {
    await interaction.editReply(buildNoticeReply(tr.t("select.none")));
    return;
  }
  const source = parsed.role === "source" ? picked : parsed.other;
  const target = parsed.role === "target" ? picked : parsed.other;

  const text = await resolveSourceText(ctx, interaction, parsed.sourceId);
  if (text === null) {
    await interaction.editReply(buildNoticeReply(tr.t("select.expired")));
    return;
  }

  const supported = await ctx.languages.get();
  // The target is always something somebody picked from a menu — this pick, or
  // the one carried in the customId — so the public post is worded in it. The
  // ephemeral acknowledgement stays in the clicker's own locale.
  const reader = ctx.i18n.forLanguage(target);
  const forced = source === AUTO_VALUE ? undefined : source;
  // The defer's "thinking" state is ephemeral, so only the clicker has any sign
  // that this is under way — and the new post is going to land in the channel.
  const thinking = showThinking(ctx.log, interaction.channel);
  try {
    const outcome = await translateWithCache(ctx, { sourceId: parsed.sourceId, text, target, source: forced });

    // Unpostable channels get here only when `resolveSourceText` found the text in
    // the cache, so the ephemeral reply is the last place left to put the result —
    // and with an audience of one it is worded in that one person's locale.
    const send = interaction.channel?.send?.bind(interaction.channel);
    const reply = buildTranslationReply({
      ...outcome,
      sourceId: parsed.sourceId,
      source: forced ?? AUTO_SOURCE,
      supported,
      tr: send ? reader : tr,
    });
    if (!send) {
      await interaction.editReply(reply);
      return;
    }
    await publishTranslation(ctx, {
      sourceId: parsed.sourceId,
      target: outcome.target,
      source: forced ?? AUTO_SOURCE,
      post: () => send({ ...reply, ...postOptionsFor(interaction.channel) }),
    });
    await interaction.editReply(buildNoticeReply(tr.t("reply.posted")));
  } finally {
    thinking.stop();
  }
}

async function resolveSourceText(
  ctx: AppContext,
  interaction: LanguageSelectInteraction,
  sourceId: string,
): Promise<string | null> {
  try {
    const cached = await ctx.cache.getSource(sourceId);
    if (cached !== null) return cached;
  } catch (err) {
    ctx.log.warn("cache getSource failed; falling back to message fetch", err);
  }

  if (!isMessageSourceId(sourceId) || !interaction.channel) return null;
  try {
    const message = await interaction.channel.messages.fetch(sourceId);
    return message.content.trim() ? message.content : null;
  } catch {
    return null;
  }
}
