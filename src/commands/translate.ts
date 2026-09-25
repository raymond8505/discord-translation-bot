import {
  MessageFlags,
  SlashCommandBuilder,
  type ApplicationCommandOptionChoiceData,
} from "discord.js";
import type { AppContext } from "../context.js";
import { rateLimitMessageFor } from "../errors.js";
import { COMMAND_DESCRIPTION_MAX, localizationsFor } from "../i18n/discord.js";
import { staticI18n, type Translator } from "../i18n/index.js";
import { menuLanguages, parseLanguageHint, parseLanguageSpec, resolveTarget } from "../locale.js";
import { publishTranslation, type PostedMessage } from "../publish.js";
import { buildNoticeReply, buildTranslationReply, type ReplyPayload } from "../reply.js";
import { sourceIdForText } from "../sourceId.js";
import { postOptionsFor, type PostChannel, type PostOptions } from "../threads.js";
import { AUTO_SOURCE, MAX_INPUT_CHARS, translateWithCache } from "../translate.js";
import { showThinking } from "../typing.js";

export const TRANSLATE_COMMAND_NAME = "translate";
const TEXT_OPTION = "text";
const TARGET_OPTION = "target";
const SOURCE_OPTION = "source";
const AUTOCOMPLETE_MAX = 25;

/** Command metadata is plain text on Discord's side, so the colon form is passed in rather than code-spanned. */
const TARGET_DESCRIPTION_PARAMS = { form: "source:target", example: "fr:en" };

export const translateCommand = new SlashCommandBuilder()
  .setName(TRANSLATE_COMMAND_NAME)
  .setDescription(staticI18n.message("en", "cmd.translate.description"))
  .setDescriptionLocalizations(localizationsFor("cmd.translate.description", COMMAND_DESCRIPTION_MAX))
  .addStringOption((option) =>
    option
      .setName(TEXT_OPTION)
      .setDescription(staticI18n.message("en", "cmd.translate.text"))
      .setDescriptionLocalizations(localizationsFor("cmd.translate.text", COMMAND_DESCRIPTION_MAX))
      .setRequired(true)
      .setMaxLength(MAX_INPUT_CHARS),
  )
  .addStringOption((option) =>
    option
      .setName(TARGET_OPTION)
      .setDescription(staticI18n.message("en", "cmd.translate.target", TARGET_DESCRIPTION_PARAMS))
      .setDescriptionLocalizations(
        localizationsFor("cmd.translate.target", COMMAND_DESCRIPTION_MAX, TARGET_DESCRIPTION_PARAMS),
      )
      .setAutocomplete(true),
  )
  .addStringOption((option) =>
    option
      .setName(SOURCE_OPTION)
      .setDescription(staticI18n.message("en", "cmd.translate.source"))
      .setDescriptionLocalizations(localizationsFor("cmd.translate.source", COMMAND_DESCRIPTION_MAX))
      .setAutocomplete(true),
  );

/** The slice of `ChatInputCommandInteraction` the handler touches. */
export interface TranslateInteraction {
  readonly locale: string;
  readonly user: { readonly id: string };
  readonly guildId: string | null;
  readonly options: {
    getString(name: string, required?: boolean): string | null;
  };
  /**
   * Null in an uncached channel, and `send` is absent on the one channel kind
   * discord.js has that cannot be posted to (a partial group DM); either way
   * there is no room to put the translation in.
   */
  readonly channel:
    | (PostChannel & {
        readonly id: string;
        send?(payload: ReplyPayload & PostOptions): Promise<PostedMessage>;
      })
    | null;
  deferReply(options: { flags: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
}

function unknownLanguage(tr: Translator, name: string): ReplyPayload {
  return buildNoticeReply(tr.t("translate.unknownLanguage", { name }));
}

export async function handleTranslate(ctx: AppContext, interaction: TranslateInteraction): Promise<void> {
  // Discord gives us 3 seconds to acknowledge; the backend can take longer.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const tr = ctx.i18n.forLocale(interaction.locale);

  // Checked after the defer (so the 3s acknowledgement still lands) and before
  // ctx.languages.get(), which is itself a backend call on a cold start.
  const limit = await ctx.rateLimiter.check({ userId: interaction.user.id, guildId: interaction.guildId });
  if (!limit.allowed) {
    await interaction.editReply(buildNoticeReply(rateLimitMessageFor(limit, tr)));
    return;
  }

  const text = (interaction.options.getString(TEXT_OPTION, true) ?? "").trim();
  if (!text) {
    await interaction.editReply(buildNoticeReply(tr.t("translate.nothing")));
    return;
  }

  const supported = await ctx.languages.get();

  const spec = parseLanguageSpec(interaction.options.getString(TARGET_OPTION) ?? "", supported, tr.displayLanguage);
  if (spec.unresolved.length > 0) {
    await interaction.editReply(unknownLanguage(tr, spec.unresolved[0] ?? ""));
    return;
  }

  let source = spec.source;
  const sourceRaw = interaction.options.getString(SOURCE_OPTION);
  if (sourceRaw) {
    source = parseLanguageHint(sourceRaw, supported, tr.displayLanguage);
    if (!source) {
      await interaction.editReply(unknownLanguage(tr, sourceRaw));
      return;
    }
  }

  const target = spec.target ?? resolveTarget(interaction.locale, supported);
  // The post is public and for whoever reads that language; the ephemeral
  // acknowledgements below stay in the invoker's own locale. Without an explicit
  // target the two are the same language anyway.
  const reader = spec.target ? ctx.i18n.forLanguage(spec.target) : tr;
  const sourceId = sourceIdForText(text);
  // The defer's "thinking" state is ephemeral, so only the invoker has any sign
  // that this is under way — and the translation is going to land in the channel.
  const thinking = showThinking(ctx.log, interaction.channel);
  try {
    const outcome = await translateWithCache(ctx, { sourceId, text, target, source: source ?? undefined });

    // The translation belongs in the channel, where the people it is for can read
    // it. With nowhere to post it there is no audience beyond the invoker, so the
    // ephemeral reply carries it instead — and is worded for them, not for the
    // room that is never going to see it.
    const send = interaction.channel?.send?.bind(interaction.channel);
    const reply = buildTranslationReply({
      ...outcome,
      sourceId,
      source: source ?? AUTO_SOURCE,
      supported,
      tr: send ? reader : tr,
    });
    if (!send) {
      await interaction.editReply(reply);
      return;
    }
    await publishTranslation(ctx, {
      sourceId,
      target: outcome.target,
      source: source ?? AUTO_SOURCE,
      post: () => send({ ...reply, ...postOptionsFor(interaction.channel) }),
    });
    await interaction.editReply(buildNoticeReply(tr.t("reply.posted")));
  } finally {
    thinking.stop();
  }
}

export interface TranslateAutocompleteInteraction {
  readonly locale: string;
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
  const uiLang = ctx.i18n.forLocale(interaction.locale).displayLanguage;
  const query = interaction.options.getFocused().trim().toLowerCase();
  const choices = menuLanguages(supported, uiLang)
    .filter((lang) => !query || lang.label.toLowerCase().includes(query) || lang.code.startsWith(query))
    .slice(0, AUTOCOMPLETE_MAX)
    .map((lang) => ({ name: lang.label, value: lang.code }));
  await interaction.respond(choices);
}
