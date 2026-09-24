import { z } from "zod";

const snowflake = z
  .string()
  .regex(/^\d{17,20}$/, "must be a Discord snowflake (17-20 digits)");

export const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: snowflake,
  GUILD_ID: snowflake,
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /**
   * Optional. Unset means an unauthenticated Redis, which is fine when it is
   * alone on the compose network and wrong when the host runs anything else:
   * without it, any other container on that network can read every cached
   * message. One variable feeds both halves — `--requirepass` on the server and
   * the client's `password` — so the two can never drift apart.
   */
  REDIS_PASSWORD: z.string().min(1).optional(),
  LT_URL: z.url({ protocol: /^https?$/ }),
  BACKEND: z.enum(["libretranslate", "ollama"]).default("libretranslate"),
  /**
   * One day, and it slides: every read of a translation puts the full TTL back
   * (`src/cache.ts`), so a phrase the guild keeps reposting stays cached while
   * it stays in use and a one-off is gone the next day. The keyspace ends up
   * the size of what a guild repeats, not of everything it has ever said.
   */
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  /**
   * Per-user budget, not a cooldown between requests: a fast-moving thread has
   * one person translating several messages in a row, and a fixed delay would
   * punish exactly the case the bot exists for. Twenty a minute is far above
   * that and far below what abuse looks like.
   */
  RATE_LIMIT_USER_PER_MIN: z.coerce.number().int().positive().default(20),
  /** Ceiling on what the whole guild can cost the backend in an hour. */
  RATE_LIMIT_GUILD_PER_HOUR: z.coerce.number().int().positive().default(2_000),
});

export type Env = z.infer<typeof envSchema>;

export type EnvSource = Record<string, string | undefined>;

/**
 * Every variable the bot reads, each named as a literal property access so
 * `scripts/validate-deploy-env.sh` can grep them and prove the deploy workflow
 * writes each one. Blank values count as unset: an `.env` line left empty gets
 * the schema default or a clear "missing" error, never a coercion failure on "".
 */
export function runtimeEnv(): EnvSource {
  const raw: EnvSource = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID,
    REDIS_URL: process.env.REDIS_URL,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    LT_URL: process.env.LT_URL,
    BACKEND: process.env.BACKEND,
    CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS,
    RATE_LIMIT_USER_PER_MIN: process.env.RATE_LIMIT_USER_PER_MIN,
    RATE_LIMIT_GUILD_PER_HOUR: process.env.RATE_LIMIT_GUILD_PER_HOUR,
  };
  return blankToUndefined(raw);
}

export function blankToUndefined(source: EnvSource): EnvSource {
  const out: EnvSource = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === "" ? undefined : value;
  }
  return out;
}

/**
 * Parses and validates the environment. Throws with every problem listed so a
 * misconfigured container exits non-zero on boot and the deploy health check
 * catches it, rather than failing later on the first translation.
 */
export function loadEnv(source: EnvSource = runtimeEnv()): Env {
  const result = envSchema.safeParse(blankToUndefined(source));
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n  ");
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  return result.data;
}
