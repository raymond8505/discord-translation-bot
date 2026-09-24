import type { CacheEntry } from "./cache.js";
import type { AppContext } from "./context.js";
import { contentHash } from "./sourceId.js";

/** Discord messages cap at 4000 chars (Nitro); anything longer is not a real message. */
export const MAX_INPUT_CHARS = 4000;

export const AUTO_SOURCE = "auto";

export interface TranslateInput {
  /**
   * Identity of the *message*, for the stored source text (edit detection, the
   * re-translate menu). Not part of the translation key — translations are
   * keyed by content, so two messages saying the same thing share one.
   */
  readonly sourceId: string;
  readonly text: string;
  readonly target: string;
  /** Backend code to force as the source language; omitted or "auto" means detect. */
  readonly source?: string;
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
 * The entry is keyed by the text, so a string reposted across ten messages is
 * translated once. A forced source is safe to read back — the source is pinned,
 * so the stored entry is exactly the one asked for — and on a miss it is also
 * written to the `auto` key: the user is correcting a wrong detection, and the
 * correction should be what everyone gets from then on.
 */
export async function translateWithCache(
  ctx: TranslateContext,
  input: TranslateInput,
): Promise<TranslationOutcome> {
  const text = input.text.slice(0, MAX_INPUT_CHARS);
  const { sourceId, target } = input;
  const source = input.source ?? AUTO_SOURCE;
  const forced = source !== AUTO_SOURCE;
  // Over the truncated text: `commands/translate.ts` hashes the untruncated
  // text for its source id, but that lives in its own `t_` namespace, and the
  // source text stored below is the truncated one the menu re-translates.
  const hash = contentHash(text);

  const hit = await safe(ctx, "get", () => ctx.cache.get(hash, source, target));
  if (hit) {
    // The entry is shared between messages, but the source text belongs to this
    // one: without it this message has no re-translate menu and no edit
    // detection, purely because someone else had said the same thing first.
    await safe(ctx, "setSource", () => ctx.cache.setSource(sourceId, text));
    return { entry: hit, target, cached: true, sameLanguage: hit.source_lang === target };
  }

  const result = await ctx.backend.translate(text, source, target);
  const entry: CacheEntry = {
    text: result.text,
    backend: ctx.backend.name,
    source_lang: result.detectedSource,
    created_at: new Date().toISOString(),
    ...(forced || result.confidence === undefined ? {} : { confidence: result.confidence }),
  };

  await safe(ctx, "set", () => ctx.cache.set(hash, source, target, entry));
  // The correction becomes the answer for everyone who asks about this text.
  if (forced) await safe(ctx, "set auto", () => ctx.cache.set(hash, AUTO_SOURCE, target, entry));
  await safe(ctx, "setSource", () => ctx.cache.setSource(sourceId, text));

  return { entry, target, cached: false, sameLanguage: result.detectedSource === target };
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
