import type { InvalidationMessage } from "../invalidation.js";
import { GUILD_ID, MESSAGE_ID } from "./interaction.fixture.js";

export interface EditedMessageOptions {
  id?: string;
  content?: string | null;
  /** A partial message carries no content until it is fetched. */
  partial?: boolean;
  /** What `fetch()` resolves the content to; defaults to `content`. */
  fetched?: string | null;
  /** Make `fetch()` reject, modelling a message that vanished mid-edit. */
  unreadable?: boolean;
  guildId?: string | null;
  preferredLocale?: string;
}

export interface FakeEditedMessage extends InvalidationMessage {
  /** One entry per `fetch()`, so the partial path can be proven. */
  readonly fetchCalls: string[];
}

/** The `messageUpdate` / `messageDelete` payload, as the invalidator reads it. */
export function makeEditedMessage(options: EditedMessageOptions = {}): FakeEditedMessage {
  const fetchCalls: string[] = [];
  const partial = options.partial ?? false;
  const message: FakeEditedMessage = {
    fetchCalls,
    id: options.id ?? MESSAGE_ID,
    partial,
    content: partial ? null : (options.content ?? null),
    guildId: options.guildId === undefined ? GUILD_ID : options.guildId,
    guild: { preferredLocale: options.preferredLocale ?? "en-US" },
    async fetch() {
      fetchCalls.push(message.id);
      if (options.unreadable) throw new Error("Unknown Message");
      return {
        ...message,
        partial: false,
        content: options.fetched === undefined ? (options.content ?? null) : options.fetched,
      };
    },
  };
  return message;
}
