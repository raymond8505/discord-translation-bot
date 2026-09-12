import { MessageFlags } from "discord.js";
import type { AppContext } from "../context.js";
import { buildNoticeReply, buildTranslationReply, type ReplyPayload } from "../reply.js";
import { isMessageSourceId } from "../sourceId.js";
import { translateWithCache } from "../translate.js";
import { parseSelectCustomId } from "./customId.js";

/** The slice of `StringSelectMenuInteraction` the handler touches. */
export interface LanguageSelectInteraction {
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

const EXPIRED = "The original text is no longer available to translate.";

/**
 * Re-translates into the chosen language. A menu on an ephemeral reply edits
 * that reply in place; a menu on a public reply (the mention trigger) answers
 * the clicker with a fresh ephemeral message so the public post stays as is.
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

  const target = interaction.values[0];
  if (!target) {
    await interaction.editReply(buildNoticeReply("No language selected."));
    return;
  }

  const text = await resolveSourceText(ctx, interaction, parsed.sourceId);
  if (text === null) {
    await interaction.editReply(buildNoticeReply(EXPIRED));
    return;
  }

  const supported = await ctx.languages.get();
  const outcome = await translateWithCache(ctx, { sourceId: parsed.sourceId, text, target });
  await interaction.editReply(buildTranslationReply({ ...outcome, sourceId: parsed.sourceId, supported }));
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
