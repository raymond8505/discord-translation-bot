import { ApplicationCommandType, ContextMenuCommandBuilder, MessageFlags } from "discord.js";
import type { AppContext } from "../context.js";
import { rateLimitMessageFor } from "../errors.js";
import { COMMAND_NAME_MAX, localizationsFor } from "../i18n/discord.js";
import { staticI18n } from "../i18n/index.js";
import { resolveTarget } from "../locale.js";
import { publishTranslation, type PostedMessage } from "../publish.js";
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
  readonly targetMessage: {
    readonly id: string;
    readonly content: string;
    reply(
      options: ReplyPayload & { allowedMentions: { repliedUser: boolean } },
    ): Promise<PostedMessage>;
  };
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
}

/**
 * The translation goes to the channel as a reply to the message it translates —
 * the whole room needs it, not the one person who right-clicked. The
 * interaction's own reply stays ephemeral and only acknowledges: refusals and
 * "no text here" are for the invoker alone, and an interaction reply is not a
 * durable message the edit-follow could come back to anyway.
 */
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

  const { targetMessage } = interaction;
  const { id, content } = targetMessage;
  if (!content.trim()) {
    await interaction.editReply(buildNoticeReply(tr.t("translate.noText")));
    return;
  }

  const supported = await ctx.languages.get();
  const target = resolveTarget(interaction.locale, supported);
  const sourceId = sourceIdForMessage(id);
  const outcome = await translateWithCache(ctx, { sourceId, text: content, target });
  await publishTranslation(ctx, {
    sourceId,
    target: outcome.target,
    source: AUTO_SOURCE,
    // Quiet, like the other two message-driven triggers: the author wrote the
    // message, they didn't ask for this.
    post: () =>
      targetMessage.reply({
        ...buildTranslationReply({ ...outcome, sourceId, source: AUTO_SOURCE, supported, tr }),
        allowedMentions: { repliedUser: false },
      }),
  });
  await interaction.editReply(buildNoticeReply(tr.t("reply.posted")));
}
