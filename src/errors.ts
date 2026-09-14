import { BackendError } from "./backends/index.js";
import type { MessageKey, Translator } from "./i18n/index.js";
import type { RateLimitDecision } from "./rateLimit.js";

/** The message key for a failed translation, keyed on the backend error kind. */
export function errorKeyFor(err: unknown): MessageKey {
  if (err instanceof BackendError) {
    switch (err.kind) {
      case "network":
      case "http":
        return "error.network";
      case "timeout":
        return "error.timeout";
      case "unavailable":
        return "error.unavailable";
      case "invalid_response":
        return "error.invalidResponse";
    }
  }
  return "error.generic";
}

/** User-facing wording for a failed translation, in the reader's language. */
export function userMessageFor(err: unknown, tr: Translator): string {
  return tr.t(errorKeyFor(err));
}

/**
 * User-facing wording for a refused request. The guild notice names no number:
 * "try again in 48 minutes" reads as a fault, and the reader cannot act on it
 * anyway — it is someone else's usage they are waiting on.
 */
export function rateLimitMessageFor(decision: RateLimitDecision, tr: Translator): string {
  return decision.scope === "guild"
    ? tr.t("error.rateLimited.guild")
    : tr.t("error.rateLimited.user", { seconds: decision.retryAfterSeconds });
}

/** Backend errors are operational (expected while LibreTranslate warms up); anything else is a bug. */
export function isOperational(err: unknown): boolean {
  return err instanceof BackendError;
}
