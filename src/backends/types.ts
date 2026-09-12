export interface TranslateResult {
  readonly text: string;
  /** Backend code of the source language; echoes `source` when it was not "auto". */
  readonly detectedSource: string;
}

export interface TranslationBackend {
  /** Stored in every cache entry so a backend swap is visible in old hits. */
  readonly name: string;
  /** `source` is "auto" (detect) or a backend language code. */
  translate(text: string, source: string, target: string): Promise<TranslateResult>;
  /** Backend language codes; populates the re-translate menu. */
  languages(): Promise<string[]>;
}

export type BackendErrorKind =
  | "timeout"
  | "http"
  | "network"
  | "invalid_response"
  | "unavailable";

/**
 * Every failure a backend can raise, classified so the interaction layer can
 * pick user-facing wording (and decide what to log) without parsing messages.
 */
export class BackendError extends Error {
  constructor(
    readonly kind: BackendErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "BackendError";
  }
}
