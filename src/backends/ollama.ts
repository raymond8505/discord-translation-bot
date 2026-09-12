import { BackendError, type TranslateResult, type TranslationBackend } from "./types.js";

/**
 * Placeholder for a phase-2 LLM backend. Selecting `BACKEND=ollama` boots the
 * bot but every translation reports "unavailable".
 *
 * TODO(phase 2): implement against Ollama's `POST /api/generate` (or
 * `/api/chat`) with a translation prompt, detect the source language in the
 * same call, and derive `languages()` from a configured list; only worth
 * building if Argos quality proves inadequate and the VPS keeps >= 8 GB free.
 */
export class OllamaBackend implements TranslationBackend {
  readonly name = "ollama";

  async translate(): Promise<TranslateResult> {
    throw new BackendError("unavailable", "Ollama backend is not implemented");
  }

  async languages(): Promise<string[]> {
    throw new BackendError("unavailable", "Ollama backend is not implemented");
  }
}
