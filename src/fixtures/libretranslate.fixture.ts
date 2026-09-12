import { libreLanguageCodes } from "./languages.fixture.js";

/** `POST /translate` with `source: "auto"`. */
export const translateResponse = {
  translatedText: "Hello, how are you?",
  detectedLanguage: { confidence: 92.5, language: "es" },
};

/** Input LibreTranslate cannot detect (emoji only): echoed back as English at 0%. */
export const undetectableResponse = {
  translatedText: "🎉🎉",
  detectedLanguage: { confidence: 0, language: "en" },
};

/** `POST /translate` with an explicit source: no `detectedLanguage` field. */
export const explicitSourceResponse = {
  translatedText: "Bonjour",
};

export const errorResponse = { error: "Unsupported target language" };

/** `GET /languages`. */
export const languagesResponse = libreLanguageCodes.map((code) => ({
  code,
  name: code.toUpperCase(),
  targets: libreLanguageCodes.filter((other) => other !== code),
}));

export function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function makeTextResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "content-type": "text/html" } });
}

export interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/**
 * A `fetch` stand-in that records every call and answers with `respond`.
 * Runner-free so it can serve tests and any future story/harness alike.
 */
export function makeFetch(
  respond: (call: RecordedCall) => Response | Promise<Response>,
): { fetch: typeof globalThis.fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const call = { url, init };
    calls.push(call);
    return respond(call);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

/** A `fetch` that never resolves until its abort signal fires; drives the real timeout path. */
export function makeHangingFetch(): typeof globalThis.fetch {
  return ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      signal.addEventListener("abort", () => reject(signal.reason));
    })) as typeof globalThis.fetch;
}
