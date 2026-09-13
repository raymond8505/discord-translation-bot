import { createCache } from "../cache.js";
import type { AppContext } from "../context.js";
import { createI18n } from "../i18n/index.js";
import { createSupportedLanguages } from "../languages.js";
import type { Logger } from "../log.js";
import { makeFakeBackend, type FakeBackend } from "./backend.fixture.js";
import { makeEnv } from "./env.fixture.js";
import { makeMessages } from "./messages.fixture.js";
import { makeFakeRedis, type FakeRedis } from "./redis.fixture.js";

export interface RecordingLogger extends Logger {
  readonly entries: Array<{ level: "info" | "warn" | "error"; message: string; meta?: unknown }>;
}

/** Runner-free logger that records every call and prints nothing. */
export function makeRecordingLogger(): RecordingLogger {
  const entries: RecordingLogger["entries"] = [];
  return {
    entries,
    info: (message, meta) => void entries.push({ level: "info", message, meta }),
    warn: (message, meta) => void entries.push({ level: "warn", message, meta }),
    error: (message, meta) => void entries.push({ level: "error", message, meta }),
  };
}

export interface TestContext extends AppContext {
  readonly backend: FakeBackend;
  readonly redis: FakeRedis;
  readonly log: RecordingLogger;
}

export interface TestContextOptions {
  backend?: FakeBackend;
  redis?: FakeRedis;
  ttlSeconds?: number;
}

export function makeContext(options: TestContextOptions = {}): TestContext {
  const backend = options.backend ?? makeFakeBackend();
  const redis = options.redis ?? makeFakeRedis();
  const log = makeRecordingLogger();
  const env = makeEnv(options.ttlSeconds === undefined ? {} : { CACHE_TTL_SECONDS: options.ttlSeconds });
  return {
    env,
    backend,
    redis,
    log,
    cache: createCache(redis, env.CACHE_TTL_SECONDS, log),
    languages: createSupportedLanguages(backend, log),
    i18n: createI18n(makeMessages()),
  };
}
