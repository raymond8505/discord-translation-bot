/**
 * Shields the parts of a message that must survive machine translation
 * untouched: `{param}` placeholders and backtick code spans. Each is swapped
 * for a token, translated, then swapped back.
 *
 * The token shape is `XZ<n>XZ`. LibreTranslate's Argos models were measured
 * against several shapes (`__0__`, `[[0]]`, `<x0/>`) and this is the one that
 * came back intact in every language and sentence position tested.
 */

const SEGMENT = /\{[A-Za-z0-9_]+\}|`[^`]*`/g;
const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;
// Tolerates a translator that re-cases the token or pads it with spaces.
const TOKEN = /xz\s*(\d+)\s*xz/gi;

export interface ProtectedText {
  readonly text: string;
  readonly slots: readonly string[];
}

export function protect(text: string): ProtectedText {
  const slots: string[] = [];
  const protectedText = text.replace(SEGMENT, (segment) => {
    slots.push(segment);
    return `XZ${slots.length - 1}XZ`;
  });
  return { text: protectedText, slots };
}

/**
 * Puts the protected segments back. Returns null when the translation lost,
 * duplicated or invented a token, so the caller can fall back to the source
 * text rather than ship a message with a hole in it.
 */
export function restore(text: string, slots: readonly string[]): string | null {
  const seen = new Set<number>();
  let valid = true;
  const restored = text.replace(TOKEN, (_match, digits: string) => {
    const index = Number(digits);
    const slot = slots[index];
    if (slot === undefined || seen.has(index)) {
      valid = false;
      return "";
    }
    seen.add(index);
    return slot;
  });
  return valid && seen.size === slots.length ? restored : null;
}

/** The `{param}` names a message interpolates, e.g. `{name}` → "name". */
export function placeholdersOf(text: string): Set<string> {
  return new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? ""));
}
