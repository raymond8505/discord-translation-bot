import { BackendError } from "./backends/index.js";
import type { MessageKey, Translator } from "./i18n/index.js";

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

/** Backend errors are operational (expected while LibreTranslate warms up); anything else is a bug. */
export function isOperational(err: unknown): boolean {
  return err instanceof BackendError;
}
