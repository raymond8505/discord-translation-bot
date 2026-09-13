import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { AppContext } from "../context.js";
import { COMMAND_DESCRIPTION_MAX, localizationsFor } from "../i18n/discord.js";
import { staticI18n } from "../i18n/index.js";
import { menuLanguages } from "../locale.js";
import { EMBED_DESCRIPTION_MAX, truncate, type ReplyPayload } from "../reply.js";

export const HELP_COMMAND_NAME = "help";

export const helpCommand = new SlashCommandBuilder()
  .setName(HELP_COMMAND_NAME)
  .setDescription(staticI18n.message("en", "cmd.help.description"))
  .setDescriptionLocalizations(localizationsFor("cmd.help.description", COMMAND_DESCRIPTION_MAX));

/** The slice of `ChatInputCommandInteraction` the handler touches. */
export interface HelpInteraction {
  readonly locale: string;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
}

/**
 * Lists every language the backend currently serves with the code that
 * `/translate target:` and `@bot <code>` accept, in the user's language.
 */
export async function handleHelp(ctx: AppContext, interaction: HelpInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const tr = ctx.i18n.forLocale(interaction.locale);

  const supported = await ctx.languages.get();
  const lines = menuLanguages(supported, tr.language).map((lang) => `**${lang.label}** · \`${lang.code}\``);
  const description = [tr.t("help.intro"), "", ...lines, "", tr.t("help.usage")].join("\n");

  const embed = new EmbedBuilder()
    .setTitle(tr.t("help.title"))
    .setDescription(truncate(description, EMBED_DESCRIPTION_MAX));
  await interaction.editReply({ embeds: [embed], components: [] });
}
