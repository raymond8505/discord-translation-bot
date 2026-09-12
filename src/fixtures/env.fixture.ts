import type { Env, EnvSource } from "../env.js";

/** Raw string values as they would arrive from `.env`. */
export const validEnvSource = {
  DISCORD_TOKEN: "test-token",
  DISCORD_CLIENT_ID: "123456789012345678",
  GUILD_ID: "876543210987654321",
  REDIS_URL: "redis://redis:6379",
  LT_URL: "http://libretranslate:5000",
  BACKEND: "libretranslate",
  CACHE_TTL_SECONDS: "2592000",
} satisfies EnvSource;

export function makeEnvSource(overrides: EnvSource = {}): EnvSource {
  return { ...validEnvSource, ...overrides };
}

/** Parsed shape, for modules that take an already-validated `Env`. */
export const validEnv: Env = {
  DISCORD_TOKEN: "test-token",
  DISCORD_CLIENT_ID: "123456789012345678",
  GUILD_ID: "876543210987654321",
  REDIS_URL: "redis://redis:6379",
  LT_URL: "http://libretranslate:5000",
  BACKEND: "libretranslate",
  CACHE_TTL_SECONDS: 2_592_000,
};

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return { ...validEnv, ...overrides };
}
