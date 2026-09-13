import { describe, expect, it } from "vitest";
import { validEnv } from "./fixtures/env.fixture.js";
import { registerCommands, type RestLike } from "./registerCommands.js";

describe("registerCommands", () => {
  it("bulk-overwrites the guild's commands with every definition", async () => {
    const puts: Array<{ route: string; body: unknown }> = [];
    const rest: RestLike = {
      async put(route, options) {
        puts.push({ route, body: options.body });
      },
    };

    const names = await registerCommands(
      { token: validEnv.DISCORD_TOKEN, clientId: validEnv.DISCORD_CLIENT_ID, guildId: validEnv.GUILD_ID },
      rest,
    );

    expect(names).toEqual(["translate", "Translate Message", "help"]);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.route).toBe(`/applications/${validEnv.DISCORD_CLIENT_ID}/guilds/${validEnv.GUILD_ID}/commands`);
    expect((puts[0]?.body as Array<{ name: string }>).map((c) => c.name)).toEqual(names);
  });
});
