import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import type { CacheEntry } from "./cache.js";
import { buildSelectCustomId } from "./components/customId.js";
import { labelFor, menuLanguages } from "./locale.js";

/** Discord limits: embed description length, options per select menu, menus we choose to show. */
const EMBED_DESCRIPTION_MAX = 4096;
const OPTIONS_PER_MENU = 25;
const MAX_MENUS = 2;

export interface TranslationReplyInput {
  readonly sourceId: string;
  readonly target: string;
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
  const { entry, target, cached, sameLanguage, sourceId, supported } = input;

  const footer = [
    `detected: ${labelFor(entry.source_lang)}`,
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

  return { embeds: [embed], components: buildLanguageMenus(sourceId, target, supported) };
}

/** A one-line notice (errors, hints, expiry) with no menus. */
export function buildNoticeReply(message: string): ReplyPayload {
  return { embeds: [new EmbedBuilder().setDescription(message)], components: [] };
}

function buildLanguageMenus(
  sourceId: string,
  target: string,
  supported: ReadonlySet<string>,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const languages = menuLanguages(supported).slice(0, OPTIONS_PER_MENU * MAX_MENUS);
  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];

  for (let index = 0; index * OPTIONS_PER_MENU < languages.length; index += 1) {
    const chunk = languages.slice(index * OPTIONS_PER_MENU, (index + 1) * OPTIONS_PER_MENU);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    if (!first || !last) break;

    const menu = new StringSelectMenuBuilder()
      .setCustomId(buildSelectCustomId(index, sourceId))
      .setPlaceholder(`Translate to… (${first.label[0]}–${last.label[0]})`)
      .addOptions(
        chunk.map((lang) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(lang.label)
            .setValue(lang.code)
            .setDefault(lang.code === target),
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
