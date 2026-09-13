/**
 * Maps Discord's locale codes onto the ISO-ish codes LibreTranslate uses.
 * `codes` is preferred-first: the runtime picks the first one the backend
 * reports, so a backend without `zt` still serves zh-TW users via `zh`.
 */
export interface LanguageDef {
  readonly label: string;
  readonly codes: readonly string[];
  readonly locales: readonly string[];
}

export const FALLBACK_TARGET = "en";

export const LANGUAGES: readonly LanguageDef[] = [
  { label: "Bulgarian", codes: ["bg"], locales: ["bg"] },
  { label: "Chinese (Simplified)", codes: ["zh"], locales: ["zh-CN"] },
  { label: "Chinese (Traditional)", codes: ["zt", "zh"], locales: ["zh-TW"] },
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
  { label: "Portuguese (Brazil)", codes: ["pb", "pt"], locales: ["pt-BR"] },
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
 * already-listed code is dropped), sorted by label.
 */
export function menuLanguages(supported: ReadonlySet<string>): MenuLanguage[] {
  const seen = new Set<string>();
  const out: MenuLanguage[] = [];
  for (const def of LANGUAGES) {
    const code = firstSupported(def, supported);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, label: def.label });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, "en"));
}

export function labelFor(code: string): string {
  return LANGUAGES.find((def) => def.codes.includes(code))?.label ?? code;
}

const HINT_PREFIXES = ["to", "into", "in"];

/**
 * Reads a target language out of free text such as "to French", "fr", or
 * "zh-TW". Returns the backend code, or null when nothing in the text names a
 * language the backend supports. Labels match with or without their
 * parenthetical, so "chinese" resolves to the first Chinese entry.
 */
export function parseLanguageHint(text: string, supported: ReadonlySet<string>): string | null {
  let phrase = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!phrase) return null;
  for (const prefix of HINT_PREFIXES) {
    if (phrase.startsWith(`${prefix} `)) {
      phrase = phrase.slice(prefix.length + 1);
      break;
    }
  }

  const matchers: Array<(def: LanguageDef) => boolean> = [
    (def) => def.label.toLowerCase() === phrase,
    (def) => def.codes.some((c) => c === phrase) || def.locales.some((l) => l.toLowerCase() === phrase),
    (def) => def.label.toLowerCase().replace(/\s*\(.*\)$/, "") === phrase,
  ];
  for (const matches of matchers) {
    const def = LANGUAGES.find(matches);
    if (def) return firstSupported(def, supported) ?? null;
  }
  if (supported.has(phrase)) return phrase;
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
export function parseLanguageSpec(text: string, supported: ReadonlySet<string>): LanguageSpec {
  const phrase = text.trim();
  if (!phrase) return EMPTY_SPEC;

  const colon = phrase.indexOf(":");
  if (colon === -1) {
    const target = parseLanguageHint(phrase, supported);
    return { source: null, target, unresolved: target ? [] : [phrase] };
  }

  const left = phrase.slice(0, colon).trim();
  const right = phrase.slice(colon + 1).trim();
  const source = left ? parseLanguageHint(left, supported) : null;
  const target = right ? parseLanguageHint(right, supported) : null;
  const unresolved = [left && !source ? left : null, right && !target ? right : null].filter(
    (part): part is string => part !== null,
  );
  return { source, target, unresolved };
}
