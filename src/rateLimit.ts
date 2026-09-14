import { log, type Logger } from "./log.js";

/**
 * The slice of node-redis the limiter uses, structural like `RedisLike` so the
 * fake in `redis.fixture.ts` satisfies it and a client swap never reaches here.
 */
export interface RateLimitRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export const USER_WINDOW_SECONDS = 60;
export const GUILD_WINDOW_SECONDS = 3600;

/**
 * How long the whole check may take before it gives up and allows the request.
 *
 * node-redis rejects a command against a dead server on its own, but only after
 * its 5 s default — measured, by killing Redis under a connected client. That
 * is five seconds added to every request during an outage, on the critical path
 * of a decision whose answer is already "allow". A budget check is worth about
 * a network round trip and nothing like a second, so it gives up far sooner.
 */
export const CHECK_TIMEOUT_MS = 1_000;

/** Both ids come straight from Discord, so neither can carry a `:` into a key. */
export interface RateLimitActor {
  readonly userId: string;
  /** Null in a DM, where there is no guild budget to spend. */
  readonly guildId: string | null;
}

export type RateLimitScope = "user" | "guild";

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Which budget was exhausted; null when the request was allowed. */
  readonly scope: RateLimitScope | null;
  /** Seconds until the exhausted window rolls over. Zero when allowed. */
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  check(actor: RateLimitActor): Promise<RateLimitDecision>;
}

export interface RateLimits {
  readonly userPerMinute: number;
  readonly guildPerHour: number;
}

const ALLOWED: RateLimitDecision = { allowed: true, scope: null, retryAfterSeconds: 0 };

/**
 * Rejects if `work` has not settled in time. The in-flight command is left to
 * finish on its own: abandoning an `INCR` costs at most one uncounted request,
 * and the key still carries its TTL.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`rate limit check exceeded ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function userWindowKey(userId: string, window: number): string {
  return `rl:u:${userId}:${window}`;
}

export function guildWindowKey(guildId: string, window: number): string {
  return `rl:g:${guildId}:${window}`;
}

/**
 * Fixed-window counters in Redis: one key per actor per window, `INCR`ed on
 * every request and expired with the window.
 *
 * Fixed rather than sliding because it costs one round trip and no Lua, and
 * because the failure it guards against is sustained abuse, not a burst
 * landing across a window boundary. Budgets rather than a cooldown between
 * requests: the bot exists for fast-moving conversations where one person
 * reasonably translates several messages in a row, and a fixed delay would
 * punish exactly that.
 *
 * Every request counts, cache hits included. What is being limited is the rate
 * of requests — each one costs a Discord API call whether or not it reaches
 * the backend.
 */
export function createRateLimiter(
  redis: RateLimitRedis,
  limits: RateLimits,
  logger: Logger = log,
  now: () => number = Date.now,
): RateLimiter {
  /** Counts one request. True while the actor is still inside its budget. */
  async function within(key: string, windowSeconds: number, limit: number): Promise<boolean> {
    const count = await redis.incr(key);
    // Only the first hit needs the TTL; re-expiring on every hit would turn the
    // fixed window into a sliding one that never lets a heavy user out of it.
    if (count === 1) await redis.expire(key, windowSeconds);
    return count <= limit;
  }

  function secondsLeftIn(windowSeconds: number): number {
    return windowSeconds - (Math.floor(now() / 1000) % windowSeconds);
  }

  function windowIndex(windowSeconds: number): number {
    return Math.floor(now() / 1000 / windowSeconds);
  }

  async function decide(actor: RateLimitActor): Promise<RateLimitDecision> {
    const userKey = userWindowKey(actor.userId, windowIndex(USER_WINDOW_SECONDS));
    if (!(await within(userKey, USER_WINDOW_SECONDS, limits.userPerMinute))) {
      return { allowed: false, scope: "user", retryAfterSeconds: secondsLeftIn(USER_WINDOW_SECONDS) };
    }

    // Only reached when the user is inside their own budget, so one person
    // cannot burn the guild's hourly allowance faster than their own minute.
    if (actor.guildId !== null) {
      const guildKey = guildWindowKey(actor.guildId, windowIndex(GUILD_WINDOW_SECONDS));
      if (!(await within(guildKey, GUILD_WINDOW_SECONDS, limits.guildPerHour))) {
        return { allowed: false, scope: "guild", retryAfterSeconds: secondsLeftIn(GUILD_WINDOW_SECONDS) };
      }
    }
    return ALLOWED;
  }

  return {
    async check(actor) {
      try {
        return await withTimeout(decide(actor), CHECK_TIMEOUT_MS);
      } catch (err) {
        // Fail open, like the cache in translate.ts: a Redis outage must cost
        // backend calls, never the bot's ability to answer. The alternative —
        // failing closed — turns a cache outage into a total outage, and hands
        // anyone who can disrupt Redis a way to silence the bot.
        logger.warn("rate limit check failed; allowing the request", err);
        return ALLOWED;
      }
    },
  };
}
