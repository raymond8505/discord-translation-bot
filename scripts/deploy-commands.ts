import { loadEnv } from "../src/env.js";
import { log } from "../src/log.js";
import { registerCommands } from "../src/registerCommands.js";

// Registers the guild commands without starting the bot. The bot also does
// this on every ready event; this script exists for checking a token/guild
// pairing before a deploy.
const env = loadEnv();
const names = await registerCommands({
  token: env.DISCORD_TOKEN,
  clientId: env.DISCORD_CLIENT_ID,
  guildId: env.GUILD_ID,
});
// The guild id is not a secret, but echoing it puts it in terminal scrollback
// and pasted CI output for no diagnostic gain: it is whatever GUILD_ID is set to.
log.info(`registered ${names.length} guild commands: ${names.join(", ")}`);
