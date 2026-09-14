import { MessageFlags } from "discord.js";
import type { AppContext } from "../context.js";
import { rateLimitMessageFor } from "../errors.js";
import { buildNoticeReply, buildTranslationReply, type ReplyPayload } from "../reply.js";
import { isMessageSourceId } from "../sourceId.js";
import { AUTO_SOURCE, translateWithCache } from "../translate.js";
import { AUTO_VALUE, parseSelectCustomId } from "./customId.js";

/** The slice of `StringSelectMenuInteraction` the handler touches. */
export interface LanguageSelectInteraction {
  readonly locale: string;
  readonly user: { readonly id: string };
  readonly guildId: string | null;
  readonly customId: string;
  readonly values: readonly string[];
  readonly message: { readonly flags: { has(flag: MessageFlags): boolean } };
  readonly channel: {
    readonly messages: { fetch(id: string): Promise<{ readonly content: string }> };
  } | null;
  deferUpdate(): Promise<unknown>;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
}

/**
 * Re-translates after a menu pick. A source menu forces (or un-forces) the
 * source and keeps the target; a target menu keeps the source. A menu on an
 * ephemeral reply edits that reply in place; a menu on a public reply (the
 * mention trigger) answers the clicker with a fresh ephemeral message so the
 * public post stays as is.
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

  const onEphemeral = interaction.message.flags.has(MessageFlags.Ephemeral);
  if (onEphemeral) {
    await interaction.deferUpdate();
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

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
  const forced = source === AUTO_VALUE ? undefined : source;
  const outcome = await translateWithCache(ctx, { sourceId: parsed.sourceId, text, target, source: forced });
  await interaction.editReply(
    buildTranslationReply({ ...outcome, sourceId: parsed.sourceId, source: forced ?? AUTO_SOURCE, supported, tr }),
  );
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
