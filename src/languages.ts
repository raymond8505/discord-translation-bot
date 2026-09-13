import type { TranslationBackend } from "./backends/index.js";
import { log, type Logger } from "./log.js";

export interface SupportedLanguages {
  /** Resolves the backend's language set: fetches until the first success, then serves the memo. */
  get(): Promise<ReadonlySet<string>>;
  /** The memoized set, or null before the first successful fetch. Synchronous for autocomplete. */
  peek(): ReadonlySet<string> | null;
}

export interface SupportedLanguagesOptions {
  /** Age after which a served memo also triggers a background re-fetch. */
  refreshMs?: number;
  now?: () => number;
}

export const LANGUAGES_REFRESH_MS = 5 * 60_000;

/**
 * LibreTranslate can take many minutes to come up on first deploy (model
 * download), so the set is fetched lazily; only a success is memoized, and a
 * failed attempt is retried on the next call. A memo older than `refreshMs`
 * is still served, but a re-fetch runs behind it so a backend whose model
 * set changed (e.g. a new `LT_LOAD_ONLY`) is picked up without a bot restart.
 */
export function createSupportedLanguages(
  backend: TranslationBackend,
  logger: Logger = log,
  options: SupportedLanguagesOptions = {},
): SupportedLanguages {
  const refreshMs = options.refreshMs ?? LANGUAGES_REFRESH_MS;
  const now = options.now ?? Date.now;
  let memo: ReadonlySet<string> | null = null;
  let fetchedAt = 0;
  let inflight: Promise<ReadonlySet<string>> | null = null;

  const fetchSet = (): Promise<ReadonlySet<string>> => {
    if (!inflight) {
      inflight = backend
        .languages()
        .then((codes) => {
          const next = new Set(codes);
          if (!memo || memo.size !== next.size || [...next].some((c) => !memo?.has(c))) {
            logger.info(`backend ${backend.name} reports ${next.size} languages`);
          }
          memo = next;
          fetchedAt = now();
          return next;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };

  const refreshIfStale = (): void => {
    if (memo && now() - fetchedAt >= refreshMs) {
      fetchSet().catch((err: unknown) => logger.warn("language set refresh failed; keeping the old set", err));
    }
  };

  return {
    async get() {
      if (memo) {
        refreshIfStale();
        return memo;
      }
      return fetchSet();
    },
    peek() {
      refreshIfStale();
      return memo;
    },
  };
}
