import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import type { CacheEntry } from "./cache.js";
import { AUTO_VALUE, buildSelectCustomId, type SelectRole } from "./components/customId.js";
import { labelFor, menuLanguages, type MenuLanguage } from "./locale.js";

/** Discord limits: embed description length, options per select menu, rows per message (5). */
const EMBED_DESCRIPTION_MAX = 4096;
const OPTIONS_PER_MENU = 25;
const MENUS_PER_ROLE = 2;

/** Below this, LibreTranslate's guess is shown with a "not sure" note and how to force the source. */
export const LOW_CONFIDENCE_PERCENT = 50;

const UNCERTAIN_NOTE =
  "If that's wrong, pick the source in the menus below, reply with `@bot <source>:<target>` " +
  "(e.g. `fr:en`), or use `/translate` with its `source` option.";

const AUTO_OPTION: MenuLanguage = { code: AUTO_VALUE, label: "Auto-detect" };

export interface TranslationReplyInput {
  readonly sourceId: string;
  readonly target: string;
  /** The source that produced this reply: a forced code, or `auto`. */
  readonly source: string;
  readonly entry: CacheEntry;
  readonly cached: boolean;
  readonly sameLanguage: boolean;
  readonly supported: ReadonlySet<string>;
}

export interface ReplyPayload {
  readonly embeds: EmbedBuilder[];
  readonly components: ActionRowBuilder<StringSelectMenuBuilder>[];
}

export function buildTranslationReply(input: TranslationReplyInput): ReplyPayload {
  const { entry, target, source, cached, sameLanguage, sourceId, supported } = input;

  const confidence = entry.confidence;
  const uncertain = confidence !== undefined && confidence < LOW_CONFIDENCE_PERCENT;
  const sourcePart =
    confidence === undefined
      ? `source: ${labelFor(entry.source_lang)}`
      : `detected: ${labelFor(entry.source_lang)} (${Math.round(confidence)}%)`;

  const footer = [
    sourcePart,
    entry.backend,
    cached ? "cached" : null,
    sameLanguage ? "already in the target language" : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const embed = new EmbedBuilder()
    .setTitle(`Translation → ${labelFor(target)}`)
    .setDescription(truncate(entry.text, EMBED_DESCRIPTION_MAX))
    .setFooter({ text: footer });
  if (uncertain) {
    embed.addFields({ name: "Not sure about the source language", value: UNCERTAIN_NOTE });
  }

  const languages = menuLanguages(supported);
  if (languages.length === 0) return { embeds: [embed], components: [] };

  const components = [
    // Source menus preselect what the backend detected (or what was forced);
    // "Auto-detect" leads so a user can hand control back after forcing.
    ...buildMenus({
      role: "source",
      languages: [AUTO_OPTION, ...languages],
      selected: entry.source_lang,
      other: target,
      sourceId,
      placeholder: "Translate from…",
    }),
    ...buildMenus({
      role: "target",
      languages,
      selected: target,
      other: source,
      sourceId,
      placeholder: "Translate to…",
    }),
  ];

  return { embeds: [embed], components };
}

/** A one-line notice (errors, hints, expiry) with no menus. */
export function buildNoticeReply(message: string): ReplyPayload {
  return { embeds: [new EmbedBuilder().setDescription(message)], components: [] };
}

interface MenuSpec {
  readonly role: SelectRole;
  readonly languages: readonly MenuLanguage[];
  readonly selected: string;
  readonly other: string;
  readonly sourceId: string;
  readonly placeholder: string;
}

function buildMenus(spec: MenuSpec): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const languages = spec.languages.slice(0, OPTIONS_PER_MENU * MENUS_PER_ROLE);
  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];

  for (let index = 0; index * OPTIONS_PER_MENU < languages.length; index += 1) {
    const chunk = languages.slice(index * OPTIONS_PER_MENU, (index + 1) * OPTIONS_PER_MENU);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) break;

    const menu = new StringSelectMenuBuilder()
      .setCustomId(
        buildSelectCustomId({ role: spec.role, menuIndex: index, other: spec.other, sourceId: spec.sourceId }),
      )
      .setPlaceholder(`${spec.placeholder} (${first.label[0]}–${last.label[0]})`)
      .addOptions(
        chunk.map((lang) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(lang.label)
            .setValue(lang.code)
            .setDefault(lang.code === spec.selected),
        ),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  }
  return rows;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
