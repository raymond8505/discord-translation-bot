import { describe, expect, it } from "vitest";
import { makeEnv } from "../fixtures/env.fixture.js";
import { BackendError, createBackend } from "./index.js";

describe("createBackend", () => {
  it("builds the LibreTranslate backend by default", () => {
    expect(createBackend(makeEnv()).name).toBe("libretranslate");
  });

  it("builds the Ollama stub, which reports itself unavailable", async () => {
    const backend = createBackend(makeEnv({ BACKEND: "ollama" }));

    expect(backend.name).toBe("ollama");
    await expect(backend.translate("x", "auto", "en")).rejects.toMatchObject({
      name: "BackendError",
      kind: "unavailable",
    } satisfies Partial<BackendError>);
    await expect(backend.languages()).rejects.toBeInstanceOf(BackendError);
  });
});
