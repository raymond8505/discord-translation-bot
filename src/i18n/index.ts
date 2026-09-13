import { resolveTarget } from "../locale.js";
import { messages as generatedMessages, type Messages } from "./messages/index.js";

export type MessageKey = keyof Messages;
export type MessageParams = Readonly<Record<string, string | number>>;

/** `en` is complete; every other language may lag behind and falls back to it key by key. */
export type MessageTable = { readonly en: Messages } & Readonly<Record<string, Partial<Messages>>>;

export interface Translator {
  /** The table language in use (`fr`, `zh-Hant`, ...), also the language to render language names in. */
  readonly language: string;
  t(key: MessageKey, params?: MessageParams): string;
}

export interface I18n {
  /** Table languages, in the backend's code spelling. */
  readonly languages: ReadonlySet<string>;
  /** Picks the table language for a Discord locale the same way targets are picked; unknown → `en`. */
  forLocale(discordLocale: string): Translator;
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

  return {
    languages,
    message,
    forLocale(discordLocale) {
      const language = resolveTarget(discordLocale, languages);
      return { language, t: (key, params) => message(language, key, params) };
    },
  };
}
