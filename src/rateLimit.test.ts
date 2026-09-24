import { describe, expect, it, vi } from "vitest";
import { makeRecordingLogger } from "./fixtures/context.fixture.js";
import { GUILD_ID, USER_ID } from "./fixtures/interaction.fixture.js";
import { makeFailingRedis, makeFakeRedis, makeHangingRedis } from "./fixtures/redis.fixture.js";
import {
  CHECK_TIMEOUT_MS,
  createRateLimiter,
  GUILD_WINDOW_SECONDS,
  USER_WINDOW_SECONDS,
  guildWindowKey,
  userWindowKey,
  type RateLimits,
} from "./rateLimit.js";

const LIMITS: RateLimits = { userPerMinute: 3, guildPerHour: 5 };
const ACTOR = { userId: USER_ID, guildId: GUILD_ID };

/** A clock the test moves by hand; starts at a window boundary for legible arithmetic. */
function makeClock(startMs = 1_800_000_000_000) {
  let now = startMs;
  return {
    now: () => now,
    advanceSeconds(seconds: number) {
      now += seconds * 1000;
    },
  };
}

function makeLimiter(limits: RateLimits = LIMITS, redis = makeFakeRedis()) {
  const clock = makeClock();
  const log = makeRecordingLogger();
  return { redis, log, clock, limiter: createRateLimiter(redis, limits, log, clock.now) };
}

describe("createRateLimiter", () => {
  it("allows requests up to the per-user limit and refuses the next", async () => {
    const { limiter } = makeLimiter();

    for (let i = 0; i < LIMITS.userPerMinute; i += 1) {
      expect((await limiter.check(ACTOR)).allowed).toBe(true);
    }

    const refused = await limiter.check(ACTOR);
    expect(refused.allowed).toBe(false);
    expect(refused.scope).toBe("user");
  });

  it("gives each user their own budget", async () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < LIMITS.userPerMinute; i += 1) await limiter.check(ACTOR);

    const other = await limiter.check({ userId: "333333333333333333", guildId: GUILD_ID });
    expect(other.allowed).toBe(true);
  });

  it("expires each window key once, on the first hit", async () => {
    const { limiter, redis } = makeLimiter();
    await limiter.check(ACTOR);
    await limiter.check(ACTOR);

    // Re-expiring on every hit would slide the window forward and never let a
    // heavy user out of it, so the count matters as much as the TTL value.
    const userExpires = redis.expireCalls.filter((c) => c.key.startsWith("rl:u:"));
    expect(userExpires).toHaveLength(1);
    expect(userExpires[0]?.seconds).toBe(USER_WINDOW_SECONDS);
    expect(redis.expireCalls.filter((c) => c.key.startsWith("rl:g:"))).toHaveLength(1);
  });

  it("starts a fresh budget in the next window", async () => {
    const { limiter, clock } = makeLimiter();
    for (let i = 0; i < LIMITS.userPerMinute; i += 1) await limiter.check(ACTOR);
    expect((await limiter.check(ACTOR)).allowed).toBe(false);

    clock.advanceSeconds(USER_WINDOW_SECONDS);
    expect((await limiter.check(ACTOR)).allowed).toBe(true);
  });

  it("reports how long is left in the exhausted window", async () => {
    const { limiter, clock } = makeLimiter();
    clock.advanceSeconds(20);
    for (let i = 0; i < LIMITS.userPerMinute; i += 1) await limiter.check(ACTOR);

    const refused = await limiter.check(ACTOR);
    expect(refused.retryAfterSeconds).toBe(USER_WINDOW_SECONDS - 20);
  });

  it("refuses on the guild budget once enough users have spent it", async () => {
    // Per-user room to spare, so only the guild ceiling can be what bites.
    const { limiter } = makeLimiter({ userPerMinute: 100, guildPerHour: 2 });
    const a = { userId: "111111111111111111", guildId: GUILD_ID };
    const b = { userId: "222222222222222222", guildId: GUILD_ID };

    expect((await limiter.check(a)).allowed).toBe(true);
    expect((await limiter.check(b)).allowed).toBe(true);

    const refused = await limiter.check({ userId: "333333333333333333", guildId: GUILD_ID });
    expect(refused.allowed).toBe(false);
    expect(refused.scope).toBe("guild");
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(GUILD_WINDOW_SECONDS);
  });

  it("does not spend the guild budget on a request the user budget already refused", async () => {
    const { limiter, redis, clock } = makeLimiter();
    for (let i = 0; i < LIMITS.userPerMinute; i += 1) await limiter.check(ACTOR);

    const guildKey = guildWindowKey(GUILD_ID, Math.floor(clock.now() / 1000 / GUILD_WINDOW_SECONDS));
    const before = redis.store.get(guildKey)?.value;
    await limiter.check(ACTOR);

    // Otherwise one spammer would burn the whole guild's hour while being
    // refused anyway, taking everyone else down with them.
    expect(redis.store.get(guildKey)?.value).toBe(before);
  });

  it("counts no guild budget outside a guild", async () => {
    const { limiter, redis } = makeLimiter();
    await limiter.check({ userId: USER_ID, guildId: null });

    expect([...redis.store.keys()].filter((k) => k.startsWith("rl:g:"))).toHaveLength(0);
  });

  it("counts no user budget when nobody asked", async () => {
    const { limiter, redis } = makeLimiter();

    // A translation refreshed because its source was edited costs the backend,
    // so the guild pays; billing it to whoever typed the edit would charge them
    // for work they never requested.
    const decision = await limiter.check({ userId: null, guildId: GUILD_ID });

    expect(decision.allowed).toBe(true);
    expect([...redis.store.keys()].filter((k) => k.startsWith("rl:u:"))).toHaveLength(0);
    expect([...redis.store.keys()].filter((k) => k.startsWith("rl:g:"))).toHaveLength(1);
  });

  it("keys each counter by window so old ones expire rather than accumulate", async () => {
    const { limiter, redis, clock } = makeLimiter();
    await limiter.check(ACTOR);

    const window = Math.floor(clock.now() / 1000 / USER_WINDOW_SECONDS);
    expect(redis.store.has(userWindowKey(USER_ID, window))).toBe(true);
  });

  it("gives up and allows the request when Redis stops answering", async () => {
    vi.useFakeTimers();
    try {
      const { limiter, log } = makeLimiter(LIMITS, makeHangingRedis());

      const pending = limiter.check(ACTOR);
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);

      // node-redis would sit on this for its own 5s default, adding that to
      // every request during an outage; the limiter's deadline is what keeps a
      // decision that is already going to be "allow" from costing that.
      expect((await pending).allowed).toBe(true);
      expect(log.entries.some((e) => e.level === "warn")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows the request when Redis is down, and says so in the log", async () => {
    const { limiter, log } = makeLimiter(LIMITS, makeFailingRedis());

    // Failing closed would turn a cache outage into a total outage, and hand
    // anyone who can disrupt Redis a way to silence the bot.
    expect((await limiter.check(ACTOR)).allowed).toBe(true);
    expect(log.entries.some((e) => e.level === "warn" && e.message.includes("rate limit"))).toBe(true);
  });
});
