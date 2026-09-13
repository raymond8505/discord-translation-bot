import type { MessageTable } from "../i18n/index.js";
import en from "../i18n/messages/en.json" with { type: "json" };
import type { Messages } from "../i18n/messages/index.js";

/** A partial French table: a hit for the keys handlers render, an English fallback for the rest. */
export const frenchMessages = {
  "reply.title": "Traduction",
  "reply.source": "source : {language}",
  "menu.auto": "Détection automatique",
  "menu.to": "Traduire vers",
  "translate.nothing": "Rien à traduire.",
  "translate.unknownLanguage": "Je ne connais pas de langue appelée « {name} ».",
  "translate.noText": "Ce message ne contient aucun texte à traduire.",
  "mention.hint": "Répondez au message à traduire et mentionnez-moi.",
  "select.expired": "Le texte d'origine n'est plus disponible.",
  "error.generic": "Une erreur s'est produite pendant la traduction. Réessayez.",
  "help.title": "Langues prises en charge",
} satisfies Partial<Messages>;

/**
 * `en` is the real table. `fr` is partial, `zh-Hans` exists without `zh-Hant`
 * (so zh-TW must fall through to it) and `nb` covers Discord's `no`.
 */
export function makeMessages(): MessageTable {
  return {
    en,
    fr: frenchMessages,
    "zh-Hans": { "reply.title": "翻译" },
    nb: { "reply.title": "Oversettelse" },
  };
}
