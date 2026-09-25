import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { AppContext } from "../context.js";
import { exampleSharedFlags } from "../flags.js";
import { COMMAND_DESCRIPTION_MAX, localizationsFor } from "../i18n/discord.js";
import { staticI18n } from "../i18n/index.js";
import { menuLanguages } from "../locale.js";
import { EMBED_DESCRIPTION_MAX, truncate, type ReplyPayload } from "../reply.js";

/** Prefixed so it does not sit on top of every other bot's `/help` in the picker. */
export const HELP_COMMAND_NAME = "tb-help";

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
  const lines = menuLanguages(supported, tr.displayLanguage).map((lang) => `**${lang.label}** · \`${lang.code}\``);
  const flags = tr.t("help.flags", { flags: exampleSharedFlags() });
  const description = [tr.t("help.intro"), "", ...lines, "", tr.t("help.usage"), "", flags].join("\n");

  const embed = new EmbedBuilder()
    .setTitle(tr.t("help.title"))
    .setDescription(truncate(description, EMBED_DESCRIPTION_MAX));
  await interaction.editReply({ embeds: [embed], components: [] });
}
