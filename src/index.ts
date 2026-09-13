import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { createClient } from "redis";
import { createBackend } from "./backends/index.js";
import { createCache } from "./cache.js";
import type { AppContext } from "./context.js";
import { loadEnv } from "./env.js";
import { startHeartbeat } from "./health.js";
import { createI18n } from "./i18n/index.js";
import { createInteractionHandler } from "./interactions.js";
import { createMessageInvalidator } from "./invalidation.js";
import { createSupportedLanguages } from "./languages.js";
import { log } from "./log.js";
import { handleMentionMessage } from "./mentions.js";
import { handleFlagReaction } from "./reactions.js";
import { registerCommands } from "./registerCommands.js";

const SHUTDOWN_GRACE_MS = 5_000;

async function main(): Promise<void> {
  const env = loadEnv();

  const redis = createClient({ url: env.REDIS_URL });
  // Without a listener a dropped connection is an unhandled 'error' event and kills the process.
  redis.on("error", (err: unknown) => log.error("redis client error", err));
  await redis.connect();
  log.info("connected to redis");

  const backend = createBackend(env);
  const ctx: AppContext = {
    env,
    backend,
    cache: createCache(redis, env.CACHE_TTL_SECONDS),
    languages: createSupportedLanguages(backend),
    i18n: createI18n(),
    log,
  };

  const client = new Client({
    // MessageContent is privileged: enable it in the developer portal or login rejects.
    // GuildMessageReactions (the flag trigger) is not, and needs no portal change.
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    // Edits, deletes and reactions on messages sent before boot arrive as partials;
    // without these they are dropped, and cache invalidation and flags miss them.
    partials: [Partials.Message, Partials.Reaction, Partials.User],
  });

  const heartbeat = startHeartbeat(client);
  const invalidator = createMessageInvalidator(ctx);

  client.once(Events.ClientReady, async (ready) => {
    log.info(`logged in as ${ready.user.tag}`);
    try {
      const names = await registerCommands({
        token: env.DISCORD_TOKEN,
        clientId: env.DISCORD_CLIENT_ID,
        guildId: env.GUILD_ID,
      });
      log.info(`registered guild commands: ${names.join(", ")}`);
    } catch (err) {
      log.error("command registration failed; existing registrations stay in place", err);
    }
    await heartbeat.beat();
    // Warm the language set; failure here is expected while LibreTranslate downloads models.
    ctx.languages.get().catch((err: unknown) => log.warn("language set not available yet", err));
  });

  client.on(Events.InteractionCreate, createInteractionHandler(ctx));
  client.on(Events.MessageCreate, (message) => void handleMentionMessage(ctx, message));
  client.on(Events.MessageReactionAdd, (reaction, user) => void handleFlagReaction(ctx, reaction, user));
  client.on(Events.MessageUpdate, (oldMessage, newMessage) => void invalidator.onUpdate(oldMessage, newMessage));
  client.on(Events.MessageDelete, (message) => void invalidator.onDelete(message));

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received; shutting down`);
    heartbeat.stop();
    setTimeout(() => {
      log.error("shutdown timed out; exiting");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
    void (async () => {
      try {
        await client.destroy();
        await redis.close();
        process.exit(0);
      } catch (err) {
        log.error("error during shutdown", err);
        process.exit(1);
      }
    })();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => log.error("unhandled rejection", reason));

  await client.login(env.DISCORD_TOKEN);
}

main().catch((err: unknown) => {
  log.error("fatal startup error", err);
  process.exit(1);
});
