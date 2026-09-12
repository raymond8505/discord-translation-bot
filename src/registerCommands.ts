import { REST, Routes } from "discord.js";
import { commandDefinitions } from "./commands/index.js";

export interface RegisterCommandsInput {
  readonly token: string;
  readonly clientId: string;
  readonly guildId: string;
}

/** The one REST call registration needs, so tests can inject a recorder. */
export interface RestLike {
  put(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
}

/**
 * Guild-scoped bulk overwrite: idempotent, applies instantly (global commands
 * take up to an hour), and the guild ends up with exactly this list.
 */
export async function registerCommands(
  input: RegisterCommandsInput,
  rest: RestLike = new REST().setToken(input.token),
): Promise<string[]> {
  await rest.put(Routes.applicationGuildCommands(input.clientId, input.guildId), {
    body: commandDefinitions,
  });
  return commandDefinitions.map((command) => command.name);
}
