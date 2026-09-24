import type { MessageMentionsHasOptions } from "discord.js";
import type { MentionMessage } from "../mentions.js";
import type { ReplyPayload } from "../reply.js";
import type { ResponseLog } from "./interaction.fixture.js";
import { GUILD_ID, MESSAGE_ID, SPANISH_TEXT, USER_ID } from "./interaction.fixture.js";
import { makePostedMessages } from "./post.fixture.js";

export const BOT_USER_ID = "999999999999999999";

export interface MentionMessageOptions {
  /** The tagging message's content; defaults to a bare mention of the bot. */
  content?: string;
  authorIsBot?: boolean;
  mentionsBot?: boolean;
  /** `null` models a message that is not a reply. */
  parent?: { id: string; content: string } | null;
  /** Make `fetchReference` reject (parent deleted or unreadable). */
  parentUnreadable?: boolean;
  preferredLocale?: string;
  /** `client.user` is null before the gateway is ready. */
  clientReady?: boolean;
  /** Who sent the tagging message; the actor the rate limiter counts. */
  authorId?: string;
  /** `null` models a DM, where there is no guild budget to spend. */
  guildId?: string | null;
}

export interface FakeMentionMessage extends MentionMessage, ResponseLog {
  /** Options passed to `mentions.has`, for asserting the ignore flags. */
  readonly hasOptions: MessageMentionsHasOptions[];
}

export function makeMentionMessage(options: MentionMessageOptions = {}): FakeMentionMessage {
  const calls: ResponseLog["calls"] = [];
  const hasOptions: MessageMentionsHasOptions[] = [];
  const posted = makePostedMessages();
  const parent = options.parent === undefined ? { id: MESSAGE_ID, content: SPANISH_TEXT } : options.parent;
  return {
    calls,
    hasOptions,
    content: options.content ?? `<@${BOT_USER_ID}>`,
    author: { bot: options.authorIsBot ?? false, id: options.authorId ?? USER_ID },
    client: { user: options.clientReady === false ? null : { id: BOT_USER_ID } },
    guildId: options.guildId === undefined ? GUILD_ID : options.guildId,
    guild: { preferredLocale: options.preferredLocale ?? "en-US" },
    reference: parent ? { messageId: parent.id } : null,
    mentions: {
      has: (userId, opts) => {
        if (opts) hasOptions.push(opts);
        return userId === BOT_USER_ID && (options.mentionsBot ?? true);
      },
    },
    async fetchReference() {
      if (!parent || options.parentUnreadable) throw new Error("Unknown Message");
      return parent;
    },
    async reply(payload: ReplyPayload & { allowedMentions: { repliedUser: boolean } }) {
      calls.push({ method: "reply", payload });
      return posted();
    },
  };
}
