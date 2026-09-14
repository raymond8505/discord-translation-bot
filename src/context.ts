import type { TranslationBackend } from "./backends/index.js";
import type { TranslationCache } from "./cache.js";
import type { Env } from "./env.js";
import type { I18n } from "./i18n/index.js";
import type { SupportedLanguages } from "./languages.js";
import type { Logger } from "./log.js";
import type { RateLimiter } from "./rateLimit.js";

/** Everything a handler needs, built once in `index.ts` and passed down explicitly. */
export interface AppContext {
  readonly env: Env;
  readonly backend: TranslationBackend;
  readonly cache: TranslationCache;
  readonly languages: SupportedLanguages;
  readonly rateLimiter: RateLimiter;
  readonly i18n: I18n;
  readonly log: Logger;
}
