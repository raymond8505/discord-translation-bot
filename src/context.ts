import type { TranslationBackend } from "./backends/index.js";
import type { TranslationCache } from "./cache.js";
import type { Env } from "./env.js";
import type { SupportedLanguages } from "./languages.js";
import type { Logger } from "./log.js";

/** Everything a handler needs, built once in `index.ts` and passed down explicitly. */
export interface AppContext {
  readonly env: Env;
  readonly backend: TranslationBackend;
  readonly cache: TranslationCache;
  readonly languages: SupportedLanguages;
  readonly log: Logger;
}
