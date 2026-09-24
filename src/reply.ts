import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import type { CacheEntry } from "./cache.js";
import {
  AUTO_VALUE,
  buildSelectCustomId,
  type SelectRole,
} from "./components/customId.js";
import { flagForLanguage } from "./flags.js";
import type { Translator } from "./i18n/index.js";
import { labelFor, menuLanguages, type MenuLanguage } from "./locale.js";

/** Discord limits: embed description length, options per select menu, rows per message (5). */
export const EMBED_DESCRIPTION_MAX = 4096;
const OPTIONS_PER_MENU = 25;
const MENUS_PER_ROLE = 2;

/**
 * Below this, the guess is still shown, with a field pointing at the source
 * menus. The floor is low because a *correct* detection scores low routinely:
 * `libretranslate/detect.py` matches a dictionary under 20 characters ("how
 * are you?" comes back as English at 30), and above that filters langdetect's
 * candidates to the loaded language set without renormalizing, discarding the
 * probability it drops rather than redistributing it. English suffers worst —
 * its nearest candidates are Dutch, German, Afrikaans and Danish, and only the
 * first two are in the set the bot loads. At 50 this fired on ordinary English.
 */
export const LOW_CONFIDENCE_PERCENT = 25;

export interface TranslationReplyInput {
  readonly sourceId: string;
  readonly target: string;
  /** The source that produced this reply: a forced code, or `auto`. */
  readonly source: string;
  readonly entry: CacheEntry;
  readonly cached: boolean;
  readonly sameLanguage: boolean;
  readonly supported: ReadonlySet<string>;
  /** Words the reply and names the languages for the reader. */
  readonly tr: Translator;
}

export interface ReplyPayload {
  readonly embeds: EmbedBuilder[];
  readonly components: ActionRowBuilder<StringSelectMenuBuilder>[];
}

export function buildTranslationReply(
  input: TranslationReplyInput,
): ReplyPayload {
  const { entry, target, source, cached, sameLanguage, sourceId, supported, tr } =
    input;

  const confidence = entry.confidence;
  const uncertain =
    confidence !== undefined && confidence < LOW_CONFIDENCE_PERCENT;
  const sourceLabel = labelFor(entry.source_lang, tr.language);
  const sourcePart =
    confidence === undefined
      ? tr.t("reply.source", { language: sourceLabel })
      : `${tr.t("reply.detected", { language: sourceLabel })} (${Math.round(confidence)}%)`;

  const footer = [
    sourcePart,
    entry.backend,
    cached ? tr.t("reply.cached") : null,
    sameLanguage ? tr.t("reply.sameLanguage") : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const embed = new EmbedBuilder()
    .setTitle(`${tr.t("reply.title")} → ${labelFor(target, tr.language)}`)
    .setDescription(truncate(entry.text, EMBED_DESCRIPTION_MAX))
    .setFooter({ text: footer });
  if (uncertain) {
    embed.addFields({
      name: tr.t("reply.uncertain.name"),
      value: tr.t("reply.uncertain.value"),
    });
  }

  const languages = menuLanguages(supported, tr.language);
  if (languages.length === 0) return { embeds: [embed], components: [] };

  const autoOption: MenuLanguage = { code: AUTO_VALUE, label: tr.t("menu.auto") };
  const components = [
    // Source menus preselect what the backend detected (or what was forced);
    // "Auto-detect" leads so a user can hand control back after forcing.
    ...buildMenus({
      role: "source",
      languages: [autoOption, ...languages],
      selected: entry.source_lang,
      other: target,
      sourceId,
      placeholder: `${tr.t("menu.from")}…`,
    }),
    ...buildMenus({
      role: "target",
      languages,
      selected: target,
      other: source,
      sourceId,
      placeholder: `${tr.t("menu.to")}…`,
    }),
  ];

  return { embeds: [embed], components };
}

/** A one-line notice (errors, hints, expiry) with no menus. */
export function buildNoticeReply(message: string): ReplyPayload {
  return {
    embeds: [new EmbedBuilder().setDescription(message)],
    components: [],
  };
}

export interface UnsupportedFlagInput {
  readonly flag: string;
  readonly supported: ReadonlySet<string>;
  readonly tr: Translator;
}

/**
 * The private answer to a flag the bot has no language for: what went wrong,
 * every flag that would have worked, and who to ask for the one that didn't.
 *
 * It lists flags rather than offering menus because it is delivered by DM,
 * and a menu answered in a DM would post the translation into that DM instead
 * of the channel the reaction happened in — every translation is a public
 * channel message. A flag is also the thing to reach for next: the reader is
 * someone who just used one.
 *
 * Languages come from `menuLanguages()`, so the names are in the same language
 * and the same order as the menus everywhere else, and a language the backend
 * did not load cannot appear. One without a country flag in the table is
 * listed by name alone rather than dropped — it is still translatable.
 */
export function buildUnsupportedFlagReply(input: UnsupportedFlagInput): ReplyPayload {
  const { flag, supported, tr } = input;
  const lines = menuLanguages(supported, tr.language).map((language) => {
    const emoji = flagForLanguage(language.code, supported);
    return emoji ? `${emoji} ${language.label}` : language.label;
  });

  // Glue lives in code; only the sentences are translated.
  const parts = [tr.t("reaction.unsupportedFlag", { flag })];
  if (lines.length > 0) parts.push(`${tr.t("reaction.supportedFlags")}\n${lines.join("\n")}`);
  parts.push(tr.t("reaction.askAdmin"));

  return buildNoticeReply(parts.join("\n\n"));
}

export interface LanguagePickerInput {
  readonly sourceId: string;
  readonly supported: ReadonlySet<string>;
  readonly tr: Translator;
  readonly notice: string;
}

/**
 * A notice with the target menus under it, for when the bot knows the message
 * but not the language that was asked for (a flag it can't serve). Nothing is
 * preselected — there is no current target to keep — and the customIds are the
 * ordinary ones, so the pick goes through the same select handler and the text
 * comes back from the cache or a message re-fetch.
 */
export function buildLanguagePickerReply(input: LanguagePickerInput): ReplyPayload {
  const { sourceId, supported, tr, notice } = input;
  const languages = menuLanguages(supported, tr.language);
  if (languages.length === 0) return buildNoticeReply(notice);

  return {
    embeds: [new EmbedBuilder().setDescription(notice)],
    components: buildMenus({
      role: "target",
      languages,
      selected: "",
      other: AUTO_VALUE,
      sourceId,
      placeholder: `${tr.t("menu.to")}…`,
    }),
  };
}

interface MenuSpec {
  readonly role: SelectRole;
  readonly languages: readonly MenuLanguage[];
  readonly selected: string;
  readonly other: string;
  readonly sourceId: string;
  readonly placeholder: string;
}

function buildMenus(
  spec: MenuSpec,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const languages = spec.languages.slice(0, OPTIONS_PER_MENU * MENUS_PER_ROLE);
  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];

  for (let index = 0; index * OPTIONS_PER_MENU < languages.length; index += 1) {
    const chunk = languages.slice(
      index * OPTIONS_PER_MENU,
      (index + 1) * OPTIONS_PER_MENU,
    );
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) break;

    const menu = new StringSelectMenuBuilder()
      .setCustomId(
        buildSelectCustomId({
          role: spec.role,
          menuIndex: index,
          other: spec.other,
          sourceId: spec.sourceId,
        }),
      )
      .setPlaceholder(
        `${spec.placeholder} (${first.label[0]}–${last.label[0]})`,
      )
      .addOptions(
        chunk.map((lang) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(lang.label)
            .setValue(lang.code)
            .setDefault(lang.code === spec.selected),
        ),
      );
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    );
  }
  return rows;
}

/** Cuts `text` to `max` characters, ending in an ellipsis when it had to. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
