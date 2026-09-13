import type { TranslateResult } from "./backends/index.js";
import type { CacheEntry } from "./cache.js";
import type { AppContext } from "./context.js";

/** Discord messages cap at 4000 chars (Nitro); anything longer is not a real message. */
export const MAX_INPUT_CHARS = 4000;

export const AUTO_SOURCE = "auto";

/**
 * At or below this confidence the detection carries no information — a two-word
 * message scores like this whatever language it is — so `fallbackSource` wins.
 */
export const INFER_SOURCE_BELOW_PERCENT = 25;

export interface TranslateInput {
  readonly sourceId: string;
  readonly text: string;
  readonly target: string;
  /** Backend code to force as the source language; omitted or "auto" means detect. */
  readonly source?: string;
  /**
   * Backend code to translate from when detection comes back below
   * `INFER_SOURCE_BELOW_PERCENT`: the language of whoever wrote the text, as
   * far as Discord reveals it. Ignored when `source` forces a language.
   */
  readonly fallbackSource?: string;
}

export interface TranslationOutcome {
  readonly entry: CacheEntry;
  readonly target: string;
  readonly cached: boolean;
  /** The backend detected the source as already being the target language. */
  readonly sameLanguage: boolean;
}

type TranslateContext = Pick<AppContext, "backend" | "cache" | "log">;

/**
 * Cache-first translation. Redis failures are logged and treated as misses
 * (or skipped writes): a cache outage costs backend calls, never a failed
 * reply. Backend failures propagate as `BackendError` for the caller to word.
 *
 * A forced source skips the cache read and overwrites the entry: the user is
 * correcting a wrong detection, and the correction should be what everyone
 * gets from then on.
 *
 * A detection the backend itself barely believes is replaced by
 * `fallbackSource`, at the cost of a second call on that rare path.
 */
export async function translateWithCache(
  ctx: TranslateContext,
  input: TranslateInput,
): Promise<TranslationOutcome> {
  const text = input.text.slice(0, MAX_INPUT_CHARS);
  const { sourceId, target } = input;
  const source = input.source ?? AUTO_SOURCE;
  const forced = source !== AUTO_SOURCE;

  if (!forced) {
    const hit = await safe(ctx, "get", () => ctx.cache.get(sourceId, target));
    if (hit) {
      return { entry: hit, target, cached: true, sameLanguage: hit.source_lang === target };
    }
  }

  let result = await ctx.backend.translate(text, source, target);
  let sourceLang = result.detectedSource;
  let inferred = false;

  const fallback = input.fallbackSource;
  if (!forced && fallback !== undefined && isGuesswork(result, fallback)) {
    ctx.log.info(
      `${sourceId}: detection ${result.detectedSource} at ${Math.round(result.confidence ?? 0)}%; ` +
        `translating from ${fallback} instead`,
    );
    result = await ctx.backend.translate(text, fallback, target);
    sourceLang = fallback;
    inferred = true;
  }

  const entry: CacheEntry = {
    text: result.text,
    backend: ctx.backend.name,
    source_lang: sourceLang,
    created_at: new Date().toISOString(),
    ...(inferred ? { source_inferred: true } : {}),
    ...(forced || inferred || result.confidence === undefined ? {} : { confidence: result.confidence }),
  };

  await safe(ctx, "set", () => ctx.cache.set(sourceId, target, entry));
  await safe(ctx, "setSource", () => ctx.cache.setSource(sourceId, text));

  return { entry, target, cached: false, sameLanguage: sourceLang === target };
}

/** A detection too weak to act on, naming something other than what the author's language suggests. */
function isGuesswork(result: TranslateResult, fallback: string): boolean {
  return (
    result.confidence !== undefined &&
    result.confidence < INFER_SOURCE_BELOW_PERCENT &&
    result.detectedSource !== fallback
  );
}

async function safe<T>(
  ctx: TranslateContext,
  op: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    ctx.log.warn(`cache ${op} failed; continuing without cache`, err);
    return null;
  }
}
