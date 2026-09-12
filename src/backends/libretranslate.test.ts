import { describe, expect, it } from "vitest";
import { libreLanguageCodes } from "../fixtures/languages.fixture.js";
import {
  errorResponse,
  explicitSourceResponse,
  languagesResponse,
  makeFetch,
  makeHangingFetch,
  makeJsonResponse,
  makeTextResponse,
  translateResponse,
  undetectableResponse,
} from "../fixtures/libretranslate.fixture.js";
import { LibreTranslateBackend } from "./libretranslate.js";
import { BackendError } from "./types.js";

const BASE = "http://libretranslate:5000";

async function expectBackendError(promise: Promise<unknown>, kind: BackendError["kind"]) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BackendError);
  expect((err as BackendError).kind).toBe(kind);
  return err as BackendError;
}

describe("LibreTranslateBackend.translate", () => {
  it("posts the LibreTranslate request shape and maps the response", async () => {
    const { fetch, calls } = makeFetch(() => makeJsonResponse(translateResponse));
    const backend = new LibreTranslateBackend(`${BASE}/`, { fetch });

    const result = await backend.translate("¿Hola, cómo estás?", "auto", "en");

    expect(result).toEqual({ text: translateResponse.translatedText, detectedSource: "es" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/translate`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      q: "¿Hola, cómo estás?",
      source: "auto",
      target: "en",
      format: "text",
    });
  });

  it("echoes the requested source when the response carries no detection", async () => {
    const { fetch } = makeFetch(() => makeJsonResponse(explicitSourceResponse));
    const backend = new LibreTranslateBackend(BASE, { fetch });

    const result = await backend.translate("Hello", "en", "fr");

    expect(result.detectedSource).toBe("en");
  });

  it("passes undetectable input through as the backend reports it", async () => {
    const { fetch } = makeFetch(() => makeJsonResponse(undetectableResponse));
    const backend = new LibreTranslateBackend(BASE, { fetch });

    const result = await backend.translate("🎉🎉", "auto", "fr");

    expect(result).toEqual({ text: "🎉🎉", detectedSource: "en" });
  });

  it("classifies HTTP failures and surfaces the server's error text", async () => {
    const { fetch } = makeFetch(() => makeJsonResponse(errorResponse, 400));
    const backend = new LibreTranslateBackend(BASE, { fetch });

    const err = await expectBackendError(backend.translate("x", "auto", "xx"), "http");

    expect(err.status).toBe(400);
    expect(err.message).toContain(errorResponse.error);
  });

  it("classifies a non-JSON 5xx as http, not invalid_response", async () => {
    const { fetch } = makeFetch(() => makeTextResponse("<html>Bad Gateway</html>", 502));
    const backend = new LibreTranslateBackend(BASE, { fetch });

    const err = await expectBackendError(backend.translate("x", "auto", "en"), "http");

    expect(err.status).toBe(502);
  });

  it("classifies a rejected fetch as network", async () => {
    const { fetch } = makeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const backend = new LibreTranslateBackend(BASE, { fetch });

    await expectBackendError(backend.translate("x", "auto", "en"), "network");
  });

  it("classifies an elapsed timeout as timeout", async () => {
    const backend = new LibreTranslateBackend(BASE, {
      fetch: makeHangingFetch(),
      translateTimeoutMs: 10,
    });

    await expectBackendError(backend.translate("x", "auto", "en"), "timeout");
  });

  it("rejects a 200 whose body is not JSON", async () => {
    const { fetch } = makeFetch(() => makeTextResponse("<html>login</html>"));
    const backend = new LibreTranslateBackend(BASE, { fetch });

    await expectBackendError(backend.translate("x", "auto", "en"), "invalid_response");
  });

  it("rejects a JSON body with no translatedText", async () => {
    const { fetch } = makeFetch(() => makeJsonResponse({ ok: true }));
    const backend = new LibreTranslateBackend(BASE, { fetch });

    await expectBackendError(backend.translate("x", "auto", "en"), "invalid_response");
  });
});

describe("LibreTranslateBackend.languages", () => {
  it("returns the backend's language codes", async () => {
    const { fetch, calls } = makeFetch(() => makeJsonResponse(languagesResponse));
    const backend = new LibreTranslateBackend(BASE, { fetch });

    await expect(backend.languages()).resolves.toEqual([...libreLanguageCodes]);
    expect(calls[0]?.url).toBe(`${BASE}/languages`);
    expect(calls[0]?.init?.method).toBe("GET");
  });

  it("rejects a malformed language list", async () => {
    const { fetch } = makeFetch(() => makeJsonResponse([{ name: "no code" }]));
    const backend = new LibreTranslateBackend(BASE, { fetch });

    await expectBackendError(backend.languages(), "invalid_response");
  });
});
