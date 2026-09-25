import { FALLBACK_TARGET, displayLanguageForLocale, icuLanguageFor, resolveLanguageCode, resolveTarget } from "../locale.js";
import { messages as generatedMessages, type Messages } from "./messages/index.js";

export type MessageKey = keyof Messages;
export type MessageParams = Readonly<Record<string, string | number>>;

/** `en` is complete; every other language may lag behind and falls back to it key by key. */
export type MessageTable = { readonly en: Messages } & Readonly<Record<string, Partial<Messages>>>;

export interface Translator {
  /** The table language the sentences come from (`fr`, `zh-Hant`, ...). */
  readonly language: string;
  /**
   * The language to render language *names* in. Not the same thing as
   * `language`: sentences exist only in the seven languages that have a message
   * file, while ICU can name a language in any locale Discord sends, so an
   * Italian reader gets English sentences and Italian language names.
   */
  readonly displayLanguage: string;
  t(key: MessageKey, params?: MessageParams): string;
}

export interface I18n {
  /** Table languages, in the backend's code spelling. */
  readonly languages: ReadonlySet<string>;
  /** Picks the table language for a Discord locale the same way targets are picked; unknown → `en`. */
  forLocale(discordLocale: string): Translator;
  /**
   * The translator for a language named by one of the table's own codes rather
   * than by a locale — a flag's language, or a target someone asked for. It is
   * how a reader whose locale Discord never sent still gets their own language:
   * naming the target names the language the answer is for.
   */
  forLanguage(code: string): Translator;
  message(language: string, key: MessageKey, params?: MessageParams): string;
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

function interpolate(text: string, params: MessageParams | undefined): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function createI18n(table: MessageTable = generatedMessages): I18n {
  const languages: ReadonlySet<string> = new Set(Object.keys(table));

  const message = (language: string, key: MessageKey, params?: MessageParams): string => {
    const localized = table[language]?.[key];
    return interpolate(localized ? localized : table.en[key], params);
  };

  const translator = (language: string, displayLanguage: string): Translator => ({
    language,
    displayLanguage,
    t: (key, params) => message(language, key, params),
  });

  return {
    languages,
    message,
    forLocale(discordLocale) {
      return translator(resolveTarget(discordLocale, languages), displayLanguageForLocale(discordLocale));
    },
    forLanguage(code) {
      // The menus' own preferred-first fallback, so a reader asking for zh-Hant
      // with only zh-Hans on the shelf is answered rather than pushed to English.
      return translator(resolveLanguageCode(code, languages) ?? FALLBACK_TARGET, icuLanguageFor(code));
    },
  };
}

/** The real table, for module-level builders (command definitions) that run before any AppContext exists. */
export const staticI18n: I18n = createI18n();
