import {
  MessageFlags,
  SlashCommandBuilder,
  type ApplicationCommandOptionChoiceData,
} from "discord.js";
import type { AppContext } from "../context.js";
import { menuLanguages, parseLanguageHint, parseLanguageSpec, resolveTarget } from "../locale.js";
import { buildNoticeReply, buildTranslationReply, type ReplyPayload } from "../reply.js";
import { sourceIdForText } from "../sourceId.js";
import { MAX_INPUT_CHARS, translateWithCache } from "../translate.js";

export const TRANSLATE_COMMAND_NAME = "translate";
const TEXT_OPTION = "text";
const TARGET_OPTION = "target";
const SOURCE_OPTION = "source";
const AUTOCOMPLETE_MAX = 25;

export const translateCommand = new SlashCommandBuilder()
  .setName(TRANSLATE_COMMAND_NAME)
  .setDescription("Translate some text (reply visible only to you)")
  .addStringOption((option) =>
    option
      .setName(TEXT_OPTION)
      .setDescription("Text to translate")
      .setRequired(true)
      .setMaxLength(MAX_INPUT_CHARS),
  )
  .addStringOption((option) =>
    option
      .setName(TARGET_OPTION)
      .setDescription("Target language (defaults to your Discord language); also accepts source:target, e.g. fr:en")
      .setAutocomplete(true),
  )
  .addStringOption((option) =>
    option
      .setName(SOURCE_OPTION)
      .setDescription("Source language, when auto-detection gets it wrong")
      .setAutocomplete(true),
  );

/** The slice of `ChatInputCommandInteraction` the handler touches. */
export interface TranslateInteraction {
  readonly locale: string;
  readonly options: {
    getString(name: string, required?: boolean): string | null;
  };
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
}

function unknownLanguage(name: string): ReplyPayload {
  return buildNoticeReply(`I don't know a language called "${name}".`);
}

export async function handleTranslate(ctx: AppContext, interaction: TranslateInteraction): Promise<void> {
  // Discord gives us 3 seconds to acknowledge; the backend can take longer.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const text = (interaction.options.getString(TEXT_OPTION, true) ?? "").trim();
  if (!text) {
    await interaction.editReply(buildNoticeReply("Nothing to translate."));
    return;
  }

  const supported = await ctx.languages.get();

  const spec = parseLanguageSpec(interaction.options.getString(TARGET_OPTION) ?? "", supported);
  if (spec.unresolved.length > 0) {
    await interaction.editReply(unknownLanguage(spec.unresolved[0] ?? ""));
    return;
  }

  let source = spec.source;
  const sourceRaw = interaction.options.getString(SOURCE_OPTION);
  if (sourceRaw) {
    source = parseLanguageHint(sourceRaw, supported);
    if (!source) {
      await interaction.editReply(unknownLanguage(sourceRaw));
      return;
    }
  }

  const target = spec.target ?? resolveTarget(interaction.locale, supported);
  const sourceId = sourceIdForText(text);
  const outcome = await translateWithCache(ctx, { sourceId, text, target, source: source ?? undefined });
  await interaction.editReply(buildTranslationReply({ ...outcome, sourceId, supported }));
}

export interface TranslateAutocompleteInteraction {
  readonly options: { getFocused(): string };
  respond(choices: readonly ApplicationCommandOptionChoiceData[]): Promise<unknown>;
}

/** Serves both `target` and `source`. Must answer within 3 seconds, so it only reads the memoized set. */
export async function handleTranslateAutocomplete(
  ctx: AppContext,
  interaction: TranslateAutocompleteInteraction,
): Promise<void> {
  const supported = ctx.languages.peek();
  if (!supported) {
    await interaction.respond([]);
    return;
  }
  const query = interaction.options.getFocused().trim().toLowerCase();
  const choices = menuLanguages(supported)
    .filter((lang) => !query || lang.label.toLowerCase().includes(query) || lang.code.startsWith(query))
    .slice(0, AUTOCOMPLETE_MAX)
    .map((lang) => ({ name: lang.label, value: lang.code }));
  await interaction.respond(choices);
}
