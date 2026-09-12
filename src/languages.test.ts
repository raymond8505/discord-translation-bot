import { describe, expect, it } from "vitest";
import { BackendError } from "./backends/index.js";
import { makeFakeBackend } from "./fixtures/backend.fixture.js";
import { makeRecordingLogger } from "./fixtures/context.fixture.js";
import { createSupportedLanguages } from "./languages.js";

describe("createSupportedLanguages", () => {
  it("fetches once and memoizes", async () => {
    const backend = makeFakeBackend();
    const languages = createSupportedLanguages(backend, makeRecordingLogger());

    expect(languages.peek()).toBeNull();
    const first = await languages.get();
    const second = await languages.get();

    expect(first).toBe(second);
    expect(first.has("en")).toBe(true);
    expect(backend.languagesCalls).toBe(1);
    expect(languages.peek()).toBe(first);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const backend = makeFakeBackend();
    const languages = createSupportedLanguages(backend, makeRecordingLogger());

    await Promise.all([languages.get(), languages.get(), languages.get()]);

    expect(backend.languagesCalls).toBe(1);
  });

  it("retries on the next call after a failure instead of caching it", async () => {
    let attempts = 0;
    const backend = makeFakeBackend({
      languages: async () => {
        attempts += 1;
        if (attempts === 1) throw new BackendError("network", "down");
        return ["en", "fr"];
      },
    });
    const languages = createSupportedLanguages(backend, makeRecordingLogger());

    await expect(languages.get()).rejects.toBeInstanceOf(BackendError);
    expect(languages.peek()).toBeNull();
    await expect(languages.get()).resolves.toEqual(new Set(["en", "fr"]));
    expect(attempts).toBe(2);
  });
});
