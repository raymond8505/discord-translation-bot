import { BackendError, type TranslateResult, type TranslationBackend } from "./types.js";

type FetchLike = typeof globalThis.fetch;

export interface LibreTranslateOptions {
  translateTimeoutMs?: number;
  languagesTimeoutMs?: number;
  /** Injected so tests exercise the real request/response mapping without global stubs. */
  fetch?: FetchLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimeout(err: unknown): boolean {
  return (
    isRecord(err) && (err.name === "TimeoutError" || err.name === "AbortError")
  );
}

/**
 * The cause's `code`, not its message. Node's fetch wraps a connection failure
 * as `TypeError: fetch failed` whose cause reads `connect ECONNREFUSED
 * 172.18.0.3:5000` — the internal address of the backend, which then sits in
 * the logs of every outage. The code (`ECONNREFUSED`, `ENOTFOUND`,
 * `ECONNRESET`) is the part worth keeping: it says what went wrong without
 * saying where the service lives.
 */
function causeCode(err: Error): string | undefined {
  const cause: unknown = err.cause;
  if (cause instanceof Error) {
    const code: unknown = (cause as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = causeCode(err);
  return code === undefined ? err.message : `${err.message} (${code})`;
}

export class LibreTranslateBackend implements TranslationBackend {
  readonly name = "libretranslate";
  private readonly baseUrl: string;
  private readonly translateTimeoutMs: number;
  private readonly languagesTimeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string, options: LibreTranslateOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.translateTimeoutMs = options.translateTimeoutMs ?? 30_000;
    this.languagesTimeoutMs = options.languagesTimeoutMs ?? 10_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async translate(text: string, source: string, target: string): Promise<TranslateResult> {
    const body = await this.request(
      "/translate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: text, source, target, format: "text" }),
      },
      this.translateTimeoutMs,
    );
    if (!isRecord(body) || typeof body.translatedText !== "string") {
      throw new BackendError("invalid_response", "LibreTranslate /translate returned no translatedText");
    }
    const detected = body.detectedLanguage;
    if (isRecord(detected) && typeof detected.language === "string") {
      const confidence = typeof detected.confidence === "number" ? detected.confidence : undefined;
      return { text: body.translatedText, detectedSource: detected.language, confidence };
    }
    return { text: body.translatedText, detectedSource: source };
  }

  async languages(): Promise<string[]> {
    const body = await this.request("/languages", { method: "GET" }, this.languagesTimeoutMs);
    if (!Array.isArray(body)) {
      throw new BackendError("invalid_response", "LibreTranslate /languages did not return a list");
    }
    const codes: string[] = [];
    for (const entry of body) {
      if (!isRecord(entry) || typeof entry.code !== "string") {
        throw new BackendError("invalid_response", "LibreTranslate /languages entry has no code");
      }
      codes.push(entry.code);
    }
    return codes;
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (isTimeout(err)) {
        throw new BackendError("timeout", `LibreTranslate ${path} timed out after ${timeoutMs}ms`);
      }
      throw new BackendError("network", `LibreTranslate ${path} unreachable: ${errorMessage(err)}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (!response.ok) {
        throw new BackendError("http", `LibreTranslate ${path} responded ${response.status}`, response.status);
      }
      throw new BackendError("invalid_response", `LibreTranslate ${path} returned non-JSON`);
    }

    if (!response.ok) {
      const detail = isRecord(body) && typeof body.error === "string" ? `: ${body.error}` : "";
      throw new BackendError("http", `LibreTranslate ${path} responded ${response.status}${detail}`, response.status);
    }
    return body;
  }
}
