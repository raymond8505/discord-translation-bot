import type { DirectRecipient } from "../dm.js";
import type { ReplyPayload } from "../reply.js";

export interface FakeRecipient extends DirectRecipient {
  /** Every payload the bot tried to send, in order. */
  readonly dms: ReplyPayload[];
}

export interface RecipientOptions {
  readonly id?: string;
  /** Rejects every send, as Discord does (`50007`) when the user disallows DMs. */
  readonly closed?: boolean;
}

export function makeRecipient(options: RecipientOptions = {}): FakeRecipient {
  const dms: ReplyPayload[] = [];
  return {
    dms,
    id: options.id ?? "",
    async send(payload) {
      // Recorded before the throw: a closed DM is still an attempt, and a test
      // asserting silence must be able to tell "never tried" from "refused".
      dms.push(payload);
      if (options.closed) throw new Error("Cannot send messages to this user");
      return payload;
    },
  };
}

export function lastDmDescription(recipient: FakeRecipient): string | undefined {
  return recipient.dms.at(-1)?.embeds[0]?.toJSON().description;
}
