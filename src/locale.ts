/**
 * Maps Discord's locale codes onto the codes the backend reports. `codes` is
 * preferred-first: the runtime picks the first one the backend's `/languages`
 * lists, so a backend without `zh-Hant` still serves zh-TW users via `zh`.
 *
 * LibreTranslate exposes three Argos codes under other names (`pb` → `pt-BR`,
 * `zh` → `zh-Hans`, `zt` → `zh-Hant`) while `LT_LOAD_ONLY` still takes the
 * Argos spelling; both spellings are listed so either backend flavour works.
 */
export interface LanguageDef {
  readonly label: string;
  readonly codes: readonly string[];
  readonly locales: readonly string[];
}

export const FALLBACK_TARGET = "en";

export const LANGUAGES: readonly LanguageDef[] = [
  { label: "Bulgarian", codes: ["bg"], locales: ["bg"] },
  { label: "Chinese (Simplified)", codes: ["zh-Hans", "zh"], locales: ["zh-CN"] },
  { label: "Chinese (Traditional)", codes: ["zh-Hant", "zt", "zh-Hans", "zh"], locales: ["zh-TW"] },
  { label: "Croatian", codes: ["hr"], locales: ["hr"] },
  { label: "Czech", codes: ["cs"], locales: ["cs"] },
  { label: "Danish", codes: ["da"], locales: ["da"] },
  { label: "Dutch", codes: ["nl"], locales: ["nl"] },
  { label: "English", codes: ["en"], locales: ["en-US", "en-GB"] },
  { label: "Finnish", codes: ["fi"], locales: ["fi"] },
  { label: "French", codes: ["fr"], locales: ["fr"] },
  { label: "German", codes: ["de"], locales: ["de"] },
  { label: "Greek", codes: ["el"], locales: ["el"] },
  { label: "Hindi", codes: ["hi"], locales: ["hi"] },
  { label: "Hungarian", codes: ["hu"], locales: ["hu"] },
  { label: "Indonesian", codes: ["id"], locales: ["id"] },
  { label: "Italian", codes: ["it"], locales: ["it"] },
  { label: "Japanese", codes: ["ja"], locales: ["ja"] },
  { label: "Korean", codes: ["ko"], locales: ["ko"] },
  { label: "Lithuanian", codes: ["lt"], locales: ["lt"] },
  { label: "Norwegian", codes: ["nb", "no"], locales: ["no"] },
  { label: "Polish", codes: ["pl"], locales: ["pl"] },
  { label: "Portuguese", codes: ["pt"], locales: [] },
  { label: "Portuguese (Brazil)", codes: ["pt-BR", "pb", "pt"], locales: ["pt-BR"] },
  { label: "Romanian", codes: ["ro"], locales: ["ro"] },
  { label: "Russian", codes: ["ru"], locales: ["ru"] },
  { label: "Spanish", codes: ["es"], locales: ["es-ES", "es-419"] },
  { label: "Swedish", codes: ["sv"], locales: ["sv-SE"] },
  { label: "Thai", codes: ["th"], locales: ["th"] },
  { label: "Turkish", codes: ["tr"], locales: ["tr"] },
  { label: "Ukrainian", codes: ["uk"], locales: ["uk"] },
  { label: "Vietnamese", codes: ["vi"], locales: ["vi"] },
];

export interface MenuLanguage {
  readonly code: string;
  readonly label: string;
}

function firstSupported(def: LanguageDef, supported: ReadonlySet<string>): string | undefined {
  return def.codes.find((code) => supported.has(code));
}

const displayNames = new Map<string, Intl.DisplayNames>();

/**
 * The language's name in `uiLang`, from ICU. English keeps the table label
 * (ICU says "Norwegian Bokmål" where the menu wants "Norwegian"). Only the
 * def's first code is passed to ICU: it is always a valid BCP-47 tag, whereas
 * `of("zt")` returns nothing and `of("auto")` throws.
 */
function displayLabel(def: LanguageDef, uiLang: string): string {
  if (uiLang === "en") return def.label;
  try {
    let names = displayNames.get(uiLang);
    if (!names) {
      names = new Intl.DisplayNames([uiLang], { type: "language", fallback: "none", languageDisplay: "standard" });
      displayNames.set(uiLang, names);
    }
    const name = names.of(def.codes[0] ?? "");
    if (!name) return def.label;
    // ICU gives "français"; a menu option and its A–Z placeholder want "Français".
    return name.charAt(0).toLocaleUpperCase(uiLang) + name.slice(1);
  } catch {
    return def.label;
  }
}

const PARENTHETICAL = /\s*[(（].*[)）]$/;

function defForLocale(locale: string): LanguageDef | undefined {
  const wanted = locale.toLowerCase();
  return LANGUAGES.find((def) => def.locales.some((l) => l.toLowerCase() === wanted));
}

/**
 * Picks the backend code to translate into for a Discord locale. Falls back
 * to the bare language prefix (`de-CH` → `de`) and finally to English, so a
 * locale the table doesn't know still yields something translatable.
 */
export function resolveTarget(locale: string, supported: ReadonlySet<string>): string {
  const def = defForLocale(locale);
  if (def) {
    const code = firstSupported(def, supported);
    if (code) return code;
  }
  const prefix = locale.toLowerCase().split("-")[0] ?? "";
  if (prefix && supported.has(prefix)) return prefix;
  return FALLBACK_TARGET;
}

/**
 * Languages to offer in the re-translate menu: every table entry the backend
 * can serve, one entry per backend code (a fallback that collapses onto an
 * already-listed code is dropped), named in `uiLang` and sorted by that name.
 */
export function menuLanguages(supported: ReadonlySet<string>, uiLang = "en"): MenuLanguage[] {
  const seen = new Set<string>();
  const out: MenuLanguage[] = [];
  for (const def of LANGUAGES) {
    const code = firstSupported(def, supported);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, label: displayLabel(def, uiLang) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, uiLang));
}

/** The language's name in `uiLang`, or the code itself when the table doesn't know it. */
export function labelFor(code: string, uiLang = "en"): string {
  const def = LANGUAGES.find((candidate) => candidate.codes.includes(code));
  return def ? displayLabel(def, uiLang) : code;
}

const HINT_PREFIXES = ["to", "into", "in"];

/**
 * Reads a target language out of free text such as "to French", "fr", or
 * "zh-TW". Returns the backend code, or null when nothing in the text names a
 * language the backend supports. Labels match in English and in `uiLang`,
 * with or without their parenthetical, so "chinese" (or "chinois") resolves
 * to the first Chinese entry.
 */
export function parseLanguageHint(text: string, supported: ReadonlySet<string>, uiLang = "en"): string | null {
  let phrase = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!phrase) return null;
  for (const prefix of HINT_PREFIXES) {
    if (phrase.startsWith(`${prefix} `)) {
      phrase = phrase.slice(prefix.length + 1);
      break;
    }
  }

  const localized = (def: LanguageDef): string => displayLabel(def, uiLang).toLowerCase();
  const matchers: Array<(def: LanguageDef) => boolean> = [
    (def) => def.label.toLowerCase() === phrase || localized(def) === phrase,
    (def) =>
      def.codes.some((c) => c.toLowerCase() === phrase) ||
      def.locales.some((l) => l.toLowerCase() === phrase),
    (def) =>
      def.label.toLowerCase().replace(PARENTHETICAL, "") === phrase ||
      localized(def).replace(PARENTHETICAL, "") === phrase,
  ];
  for (const matches of matchers) {
    const def = LANGUAGES.find(matches);
    if (def) return firstSupported(def, supported) ?? null;
  }
  // A backend code the table doesn't know, matched case-insensitively (`pt-br` → `pt-BR`).
  for (const code of supported) {
    if (code.toLowerCase() === phrase) return code;
  }
  return null;
}

export interface LanguageSpec {
  readonly source: string | null;
  readonly target: string | null;
  /** Parts that named no supported language, e.g. `["klingon"]` for "klingon:en". */
  readonly unresolved: readonly string[];
}

const EMPTY_SPEC: LanguageSpec = { source: null, target: null, unresolved: [] };

/**
 * Reads a `source:target` pair out of free text. Either side may be empty
 * (`fr:` forces the source, `:en` picks the target) and text without a colon
 * is a bare target hint. Each side accepts whatever `parseLanguageHint` does.
 */
export function parseLanguageSpec(text: string, supported: ReadonlySet<string>, uiLang = "en"): LanguageSpec {
  const phrase = text.trim();
  if (!phrase) return EMPTY_SPEC;

  const colon = phrase.indexOf(":");
  if (colon === -1) {
    const target = parseLanguageHint(phrase, supported, uiLang);
    return { source: null, target, unresolved: target ? [] : [phrase] };
  }

  const left = phrase.slice(0, colon).trim();
  const right = phrase.slice(colon + 1).trim();
  const source = left ? parseLanguageHint(left, supported, uiLang) : null;
  const target = right ? parseLanguageHint(right, supported, uiLang) : null;
  const unresolved = [left && !source ? left : null, right && !target ? right : null].filter(
    (part): part is string => part !== null,
  );
  return { source, target, unresolved };
}
