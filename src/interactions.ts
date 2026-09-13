import { MessageFlags, type Interaction } from "discord.js";
import { TRANSLATE_COMMAND_NAME, handleTranslate, handleTranslateAutocomplete } from "./commands/translate.js";
import { TRANSLATE_MESSAGE_COMMAND_NAME, handleTranslateMessage } from "./commands/translateMessage.js";
import { isSelectCustomId } from "./components/customId.js";
import { handleLanguageSelect } from "./components/languageSelect.js";
import type { AppContext } from "./context.js";
import { isOperational, userMessageFor } from "./errors.js";
import { buildNoticeReply } from "./reply.js";

/**
 * One listener for every interaction. Nothing thrown by a handler escapes:
 * the user gets a worded notice and the process keeps serving.
 */
export function createInteractionHandler(ctx: AppContext): (interaction: Interaction) => Promise<void> {
  return async (interaction) => {
    try {
      await route(ctx, interaction);
    } catch (err) {
      await respondWithError(ctx, interaction, err);
    }
  };
}

async function route(ctx: AppContext, interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === TRANSLATE_COMMAND_NAME) return handleTranslate(ctx, interaction);
    ctx.log.warn(`unknown slash command ${interaction.commandName}`);
    return;
  }
  if (interaction.isMessageContextMenuCommand()) {
    if (interaction.commandName === TRANSLATE_MESSAGE_COMMAND_NAME) return handleTranslateMessage(ctx, interaction);
    ctx.log.warn(`unknown context command ${interaction.commandName}`);
    return;
  }
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === TRANSLATE_COMMAND_NAME) return handleTranslateAutocomplete(ctx, interaction);
    await interaction.respond([]);
    return;
  }
  if (interaction.isStringSelectMenu() && isSelectCustomId(interaction.customId)) {
    return handleLanguageSelect(ctx, interaction);
  }
}

async function respondWithError(ctx: AppContext, interaction: Interaction, err: unknown): Promise<void> {
  if (isOperational(err)) ctx.log.warn("interaction failed: backend", err);
  else ctx.log.error("interaction failed: unexpected", err);

  try {
    if (interaction.isAutocomplete()) {
      if (!interaction.responded) await interaction.respond([]);
      return;
    }
    if (!interaction.isRepliable()) return;
    const notice = buildNoticeReply(userMessageFor(err, ctx.i18n.forLocale(interaction.locale)));
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(notice);
    } else {
      await interaction.reply({ ...notice, flags: MessageFlags.Ephemeral });
    }
  } catch (deliveryErr) {
    ctx.log.error("could not deliver error notice", deliveryErr);
  }
}
