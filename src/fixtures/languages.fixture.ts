/**
 * Language codes as a LibreTranslate `/languages` call reports them (it
 * renames Argos's `pb`/`zh`/`zt` to `pt-BR`/`zh-Hans`/`zh-Hant`). A realistic
 * subset: includes those renamed codes and `nb`, and omits Croatian (`hr`,
 * which Argos has no model for) and Lithuanian (`lt`, an available model this
 * install simply hasn't loaded).
 */
export const libreLanguageCodes: readonly string[] = [
  "en", "ar", "bg", "cs", "da", "de", "el", "es", "fi", "fr", "hi", "hu",
  "id", "it", "ja", "ko", "nb", "nl", "pl", "pt", "pt-BR", "ro", "ru", "sv",
  "th", "tr", "uk", "vi", "zh-Hans", "zh-Hant",
];

export function makeSupported(codes: readonly string[] = libreLanguageCodes): ReadonlySet<string> {
  return new Set(codes);
}

/**
 * A backend that reports only bare ISO codes (no `pt-BR`, `zh-Hans`,
 * `zh-Hant`, `nb`), to exercise the table's fallbacks.
 */
export const primaryOnlyCodes: readonly string[] = [
  ...libreLanguageCodes.filter((code) => !["pt-BR", "zh-Hans", "zh-Hant", "nb"].includes(code)),
  "zh",
];
