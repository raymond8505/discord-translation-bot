import { BackendError } from "./backends/index.js";

/** User-facing wording for a failed translation, keyed on the backend error kind. */
export function userMessageFor(err: unknown): string {
  if (err instanceof BackendError) {
    switch (err.kind) {
      case "network":
      case "http":
        return "The translation service is still starting up or is unavailable. Try again in a few minutes.";
      case "timeout":
        return "The translation service took too long to respond. Try again shortly.";
      case "unavailable":
        return "The configured translation backend is not available.";
      case "invalid_response":
        return "The translation service returned something I couldn't read.";
    }
  }
  return "Something went wrong while translating. Please try again.";
}

/** Backend errors are operational (expected while LibreTranslate warms up); anything else is a bug. */
export function isOperational(err: unknown): boolean {
  return err instanceof BackendError;
}
