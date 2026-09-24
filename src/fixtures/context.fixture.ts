import { createCache } from "../cache.js";
import type { AppContext } from "../context.js";
import { createI18n } from "../i18n/index.js";
import { createSupportedLanguages } from "../languages.js";
import type { Logger } from "../log.js";
import { createPostRegistry } from "../posts.js";
import { createRateLimiter, type RateLimiter, type RateLimitScope } from "../rateLimit.js";
import { makeFakeBackend, type FakeBackend } from "./backend.fixture.js";
import { makeEnv } from "./env.fixture.js";
import { makeFakeMessageEditor, type FakeMessageEditor } from "./messageEditor.fixture.js";
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
  readonly messages: FakeMessageEditor;
  readonly log: RecordingLogger;
}

export interface TestContextOptions {
  backend?: FakeBackend;
  redis?: FakeRedis;
  ttlSeconds?: number;
  /**
   * Swapped in whole rather than configured, so a handler test that wants to
   * see the over-limit path says so in one line instead of issuing 20 requests.
   * `alwaysLimited()` is the usual argument.
   */
  rateLimiter?: RateLimiter;
  /** Swapped in whole for the edit-follow paths that need a post to be gone or to fail. */
  messages?: FakeMessageEditor;
}

/** A limiter that refuses everything, for exercising a handler's over-limit branch. */
export function alwaysLimited(
  scope: RateLimitScope = "user",
  retryAfterSeconds = 30,
): RateLimiter {
  return { check: async () => ({ allowed: false, scope, retryAfterSeconds }) };
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
    posts: createPostRegistry(redis, env.CACHE_TTL_SECONDS, log),
    messages: options.messages ?? makeFakeMessageEditor(),
    languages: createSupportedLanguages(backend, log),
    rateLimiter:
      options.rateLimiter ??
      createRateLimiter(
        redis,
        { userPerMinute: env.RATE_LIMIT_USER_PER_MIN, guildPerHour: env.RATE_LIMIT_GUILD_PER_HOUR },
        log,
      ),
    i18n: createI18n(makeMessages()),
  };
}
