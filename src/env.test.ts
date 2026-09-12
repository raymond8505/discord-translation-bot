import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";
import { makeEnvSource } from "./fixtures/env.fixture.js";

describe("loadEnv", () => {
  it("parses a complete source and coerces the TTL to a number", () => {
    const env = loadEnv(makeEnvSource());
    expect(env.CACHE_TTL_SECONDS).toBe(2_592_000);
    expect(env.BACKEND).toBe("libretranslate");
  });

  it("applies defaults when optional vars are absent or blank", () => {
    const env = loadEnv(
      makeEnvSource({ BACKEND: undefined, CACHE_TTL_SECONDS: "" }),
    );
    expect(env.BACKEND).toBe("libretranslate");
    expect(env.CACHE_TTL_SECONDS).toBe(2_592_000);
  });

  it("names every missing required var in the error", () => {
    expect(() =>
      loadEnv(makeEnvSource({ DISCORD_TOKEN: "", GUILD_ID: undefined })),
    ).toThrow(/DISCORD_TOKEN[\s\S]*GUILD_ID/);
  });

  it("rejects ids that are not snowflakes", () => {
    expect(() => loadEnv(makeEnvSource({ DISCORD_CLIENT_ID: "abc" }))).toThrow(
      /DISCORD_CLIENT_ID.*snowflake/,
    );
  });

  it("rejects an unknown backend", () => {
    expect(() => loadEnv(makeEnvSource({ BACKEND: "google" }))).toThrow(
      /BACKEND/,
    );
  });

  it("rejects a non-positive or fractional TTL", () => {
    expect(() => loadEnv(makeEnvSource({ CACHE_TTL_SECONDS: "0" }))).toThrow(
      /CACHE_TTL_SECONDS/,
    );
    expect(() => loadEnv(makeEnvSource({ CACHE_TTL_SECONDS: "1.5" }))).toThrow(
      /CACHE_TTL_SECONDS/,
    );
  });

  it("rejects malformed URLs", () => {
    expect(() => loadEnv(makeEnvSource({ LT_URL: "libretranslate:5000" }))).toThrow(
      /LT_URL/,
    );
  });

  it("strips keys the schema does not know", () => {
    const env = loadEnv(makeEnvSource({ LT_LOAD_ONLY: "en,fr" }));
    expect(env).not.toHaveProperty("LT_LOAD_ONLY");
  });
});
