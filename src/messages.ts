import { DiscordAPIError, RESTJSONErrorCodes, type Client } from "discord.js";
import type { PostRef } from "./posts.js";
import type { ReplyPayload } from "./reply.js";

/**
 * `gone` means the post can never be edited: it or its channel is absent, or
 * the bot lacks access to it. The caller prunes the registry on it rather than
 * re-trying the same dead id on every future edit.
 */
export type EditOutcome = "ok" | "gone";

/**
 * Editing one of the bot's own posts. The one place in `src/` that reaches
 * Discord outside a handler, kept behind an interface so the invalidator can be
 * driven by a fake in tests.
 */
export interface MessageEditor {
  edit(ref: PostRef, payload: ReplyPayload): Promise<EditOutcome>;
}

const GONE_CODES: ReadonlySet<number | string> = new Set([
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.MissingAccess,
]);

export function createMessageEditor(client: Client): MessageEditor {
  return {
    async edit(ref, payload) {
      try {
        const channel = await client.channels.fetch(ref.channelId);
        if (!channel?.isTextBased() || !("messages" in channel)) return "gone";
        const message = await channel.messages.fetch(ref.messageId);
        await message.edit(payload);
        return "ok";
      } catch (err) {
        if (err instanceof DiscordAPIError && GONE_CODES.has(err.code)) return "gone";
        throw err;
      }
    },
  };
}
