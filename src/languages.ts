import type { TranslationBackend } from "./backends/index.js";
import { log, type Logger } from "./log.js";

export interface SupportedLanguages {
  /** Resolves the backend's language set, fetching it once and memoizing on success. */
  get(): Promise<ReadonlySet<string>>;
  /** The memoized set, or null before the first successful fetch. Synchronous for autocomplete. */
  peek(): ReadonlySet<string> | null;
}

/**
 * LibreTranslate can take many minutes to come up on first deploy (model
 * download), so the set is fetched lazily; only a success is memoized, and a
 * failed attempt is retried on the next call.
 */
export function createSupportedLanguages(
  backend: TranslationBackend,
  logger: Logger = log,
): SupportedLanguages {
  let memo: ReadonlySet<string> | null = null;
  let inflight: Promise<ReadonlySet<string>> | null = null;

  return {
    async get() {
      if (memo) return memo;
      if (!inflight) {
        inflight = backend
          .languages()
          .then((codes) => {
            memo = new Set(codes);
            logger.info(`backend ${backend.name} reports ${memo.size} languages`);
            return memo;
          })
          .finally(() => {
            inflight = null;
          });
      }
      return inflight;
    },
    peek() {
      return memo;
    },
  };
}
