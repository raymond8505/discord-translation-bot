/**
 * Language codes as a LibreTranslate `/languages` call reports them. A
 * realistic subset: includes the alt codes (`zt`, `nb`, `pb`) and omits
 * Croatian (`hr`, which Argos has no model for) and Lithuanian (`lt`, an
 * available model this install simply hasn't loaded).
 */
export const libreLanguageCodes: readonly string[] = [
  "en", "ar", "bg", "cs", "da", "de", "el", "es", "fi", "fr", "hi", "hu",
  "id", "it", "ja", "ko", "nb", "nl", "pl", "pt", "pb", "ro", "ru", "sv",
  "th", "tr", "uk", "vi", "zh", "zt",
];

export function makeSupported(codes: readonly string[] = libreLanguageCodes): ReadonlySet<string> {
  return new Set(codes);
}

/** A backend that lacks every alternate code, to exercise the fallbacks. */
export const primaryOnlyCodes: readonly string[] = libreLanguageCodes.filter(
  (code) => !["zt", "nb", "pb"].includes(code),
);
