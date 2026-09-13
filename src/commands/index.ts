import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { helpCommand } from "./help.js";
import { translateCommand } from "./translate.js";
import { translateMessageCommand } from "./translateMessage.js";

/** Every command the bot registers, in the shape the REST bulk-PUT expects. */
export const commandDefinitions: RESTPostAPIApplicationCommandsJSONBody[] = [
  translateCommand.toJSON(),
  translateMessageCommand.toJSON(),
  helpCommand.toJSON(),
];
