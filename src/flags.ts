import { resolveLanguageCode } from "./locale.js";

/**
 * Flag emoji → language, for the reaction trigger. Several flags mean one
 * language and the sub-regions collapse: 🇬🇧 🇺🇸 🇨🇦 🇦🇺 🏴󠁧󠁢󠁥󠁮󠁧󠁿 are all `en`, never
 * `en-GB`/`en-CA`. The table maps a region onto a code `LANGUAGES` already
 * lists, so the two cannot drift, and resolution runs through
 * `resolveLanguageCode` — a flag for a language this backend doesn't load
 * resolves to null exactly like a country nobody's table knows, and the
 * caller offers the menus for both.
 *
 * Bilingual regions take their plurality language (🇨🇭 German, 🇧🇪 Dutch) and 🇨🇦
 * is English by request. Regions genuinely too split to guess are simply left
 * out: null is the honest answer and the reactor gets a menu.
 */
const FLAG_LANGUAGES: Readonly<Record<string, string>> = {
  BG: "bg",
  CN: "zh-Hans",
  SG: "zh-Hans",
  TW: "zh-Hant",
  HK: "zh-Hant",
  MO: "zh-Hant",
  HR: "hr",
  CZ: "cs",
  DK: "da",
  NL: "nl",
  BE: "nl",
  GB: "en",
  GBENG: "en",
  GBSCT: "en",
  GBWLS: "en",
  US: "en",
  CA: "en",
  AU: "en",
  NZ: "en",
  IE: "en",
  ZA: "en",
  FI: "fi",
  FR: "fr",
  MC: "fr",
  DE: "de",
  AT: "de",
  CH: "de",
  LI: "de",
  GR: "el",
  CY: "el",
  IN: "hi",
  HU: "hu",
  ID: "id",
  IT: "it",
  SM: "it",
  VA: "it",
  JP: "ja",
  KR: "ko",
  KP: "ko",
  LT: "lt",
  NO: "nb",
  PL: "pl",
  PT: "pt",
  AO: "pt",
  MZ: "pt",
  BR: "pt-BR",
  RO: "ro",
  MD: "ro",
  RU: "ru",
  ES: "es",
  MX: "es",
  AR: "es",
  CO: "es",
  CL: "es",
  PE: "es",
  VE: "es",
  EC: "es",
  GT: "es",
  CU: "es",
  BO: "es",
  DO: "es",
  HN: "es",
  PY: "es",
  SV: "es",
  NI: "es",
  CR: "es",
  PA: "es",
  UY: "es",
  GQ: "es",
  PR: "es",
  SE: "sv",
  TH: "th",
  TR: "tr",
  UA: "uk",
  VN: "vi",
};

const INDICATOR_FIRST = 0x1f1e6;
const INDICATOR_LAST = 0x1f1ff;
const BLACK_FLAG = 0x1f3f4;
const TAG_LETTER_A = 0xe0061;
const TAG_LETTER_Z = 0xe007a;
const TAG_CANCEL = 0xe007f;
const UPPERCASE_A = 0x41;

/**
 * The region an emoji names: 🇫🇷 → `FR` from its two regional indicators,
 * 🏴󠁧󠁢󠁥󠁮󠁧󠁿 → `GBENG` from its tag sequence. Null for everything else, including 👍,
 * 🏳️‍🌈 (white flag) and 🏴‍☠️ (a black flag whose sequence is not tag letters), so
 * the trigger can stay silent on reactions that mean nothing to it.
 */
export function regionForFlag(emoji: string): string | null {
  const points = [...emoji].map((char) => char.codePointAt(0) ?? 0);
  if (points.length === 2 && points.every((p) => p >= INDICATOR_FIRST && p <= INDICATOR_LAST)) {
    return points.map((p) => String.fromCharCode(p - INDICATOR_FIRST + UPPERCASE_A)).join("");
  }
  if (points.length < 4 || points[0] !== BLACK_FLAG || points.at(-1) !== TAG_CANCEL) return null;
  const tags = points.slice(1, -1);
  if (!tags.every((p) => p >= TAG_LETTER_A && p <= TAG_LETTER_Z)) return null;
  return tags.map((p) => String.fromCharCode(p - TAG_LETTER_A + UPPERCASE_A)).join("");
}

/** The flag for a two-letter region: the inverse of `regionForFlag`, for showing examples. */
export function flagForRegion(region: string): string {
  return [...region.toUpperCase()]
    .map((letter) => String.fromCodePoint(letter.charCodeAt(0) - UPPERCASE_A + INDICATOR_FIRST))
    .join("");
}

/**
 * Flags that all name one language, for the help page's example of flags
 * sharing a language. Read out of the table so the example can never drift
 * from the mapping; English because it is what the most flags point at, which
 * is also what `help.flags` says the example means.
 */
export function exampleSharedFlags(limit = 4): string {
  return Object.entries(FLAG_LANGUAGES)
    .filter(([region, code]) => code === "en" && region.length === 2)
    .slice(0, limit)
    .map(([region]) => flagForRegion(region))
    .join(" ");
}

/**
 * A flag that asks for this backend code, for showing someone which languages
 * are on offer. Two-letter regions only: a subdivision flag renders as a bare
 * fallback on many clients, and every language here has a country that names
 * it. The first region in table order wins, so the pairing is stable.
 */
export function flagForLanguage(code: string, supported: ReadonlySet<string>): string | null {
  for (const [region, tableCode] of Object.entries(FLAG_LANGUAGES)) {
    if (region.length !== 2) continue;
    if (resolveLanguageCode(tableCode, supported) === code) return flagForRegion(region);
  }
  return null;
}

/** True for any country or subdivision flag, whether or not it names a language. */
export function isFlagEmoji(emoji: string): boolean {
  return regionForFlag(emoji) !== null;
}

/**
 * The backend code a flag asks for, or null when the flag names no language
 * the backend serves — an unmapped region, or one whose language this install
 * didn't load.
 */
export function languageForFlag(emoji: string, supported: ReadonlySet<string>): string | null {
  const region = regionForFlag(emoji);
  if (!region) return null;
  const code = FLAG_LANGUAGES[region];
  return code ? resolveLanguageCode(code, supported) : null;
}
