import { Locale, type LocalizationMap } from "discord.js";
import { LANGUAGES } from "../locale.js";
import { staticI18n, type I18n, type MessageKey, type MessageParams } from "./index.js";

/** Discord's limits for command and option descriptions, and for context-menu command names. */
export const COMMAND_DESCRIPTION_MAX = 100;
export const COMMAND_NAME_MAX = 32;

const DISCORD_LOCALES = new Set<string>(Object.values(Locale));

function isDiscordLocale(value: string): value is Locale {
  return DISCORD_LOCALES.has(value);
}

/**
 * The per-locale map a command builder's `set*Localizations` takes, from the
 * message table. A locale whose message is the English one (no file, or the
 * key not translated yet) is left out so Discord shows the default. A value
 * longer than `max` is left out too: the builder validates lengths at call
 * time, which is module load, and one over-long generated string must not
 * take the bot down.
 */
export function localizationsFor(
  key: MessageKey,
  max: number,
  params?: MessageParams,
  i18n: I18n = staticI18n,
): LocalizationMap {
  const english = i18n.message("en", key, params);
  const out: LocalizationMap = {};
  for (const def of LANGUAGES) {
    for (const locale of def.locales) {
      if (!isDiscordLocale(locale)) continue;
      const value = i18n.forLocale(locale).t(key, params);
      if (value === english || value.length > max) continue;
      out[locale] = value;
    }
  }
  return out;
}
