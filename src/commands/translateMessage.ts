import { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags } from "discord.js";
import type { AppContext } from "../context.js";
import { rateLimitMessageFor } from "../errors.js";
import { COMMAND_NAME_MAX, localizationsFor } from "../i18n/discord.js";
import { staticI18n } from "../i18n/index.js";
import { resolveTarget } from "../locale.js";
import { buildNoticeReply, buildTranslationReply, type ReplyPayload } from "../reply.js";
import { sourceIdForMessage } from "../sourceId.js";
import { AUTO_SOURCE, translateWithCache } from "../translate.js";

/** The default name is what `interaction.commandName` carries whatever the user's locale. */
export const TRANSLATE_MESSAGE_COMMAND_NAME = staticI18n.message("en", "cmd.translateMessage.name");

export const translateMessageCommand = new ContextMenuCommandBuilder()
  .setName(TRANSLATE_MESSAGE_COMMAND_NAME)
  .setNameLocalizations(localizationsFor("cmd.translateMessage.name", COMMAND_NAME_MAX))
  .setType(ApplicationCommandType.Message);

/** The slice of `MessageContextMenuCommandInteraction` the handler touches. */
export interface TranslateMessageInteraction {
  readonly locale: string;
  readonly user: { readonly id: string };
  readonly guildId: string | null;
  readonly targetMessage: { readonly id: string; readonly content: string };
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
}

export async function handleTranslateMessage(
  ctx: AppContext,
  interaction: TranslateMessageInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const tr = ctx.i18n.forLocale(interaction.locale);

  const limit = await ctx.rateLimiter.check({ userId: interaction.user.id, guildId: interaction.guildId });
  if (!limit.allowed) {
    await interaction.editReply(buildNoticeReply(rateLimitMessageFor(limit, tr)));
    return;
  }

  const { id, content } = interaction.targetMessage;
  if (!content.trim()) {
    await interaction.editReply(buildNoticeReply(tr.t("translate.noText")));
    return;
  }

  const supported = await ctx.languages.get();
  const target = resolveTarget(interaction.locale, supported);
  const sourceId = sourceIdForMessage(id);
  const outcome = await translateWithCache(ctx, { sourceId, text: content, target });
  await interaction.editReply(buildTranslationReply({ ...outcome, sourceId, source: AUTO_SOURCE, supported, tr }));
}
