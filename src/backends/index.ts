import type { Env } from "../env.js";
import { LibreTranslateBackend } from "./libretranslate.js";
import { OllamaBackend } from "./ollama.js";
import type { TranslationBackend } from "./types.js";

export type { TranslateResult, TranslationBackend, BackendErrorKind } from "./types.js";
export { BackendError } from "./types.js";

/** Swapping backends is a `BACKEND` env change; nothing else references a concrete class. */
export function createBackend(env: Pick<Env, "BACKEND" | "LT_URL">): TranslationBackend {
  switch (env.BACKEND) {
    case "libretranslate":
      return new LibreTranslateBackend(env.LT_URL);
    case "ollama":
      return new OllamaBackend();
  }
}
