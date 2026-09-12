import { z } from "zod";

const snowflake = z
  .string()
  .regex(/^\d{17,20}$/, "must be a Discord snowflake (17-20 digits)");

export const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: snowflake,
  GUILD_ID: snowflake,
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  LT_URL: z.url({ protocol: /^https?$/ }),
  BACKEND: z.enum(["libretranslate", "ollama"]).default("libretranslate"),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
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
    LT_URL: process.env.LT_URL,
    BACKEND: process.env.BACKEND,
    CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS,
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
