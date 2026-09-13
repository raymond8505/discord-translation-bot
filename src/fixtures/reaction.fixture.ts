import type { FlagReaction, ReactedMessage, ReactingUser, ReactionSummary } from "../reactions.js";
import type { ReplyPayload } from "../reply.js";
import { MESSAGE_ID, SPANISH_TEXT, type ResponseLog } from "./interaction.fixture.js";
import { BOT_USER_ID } from "./message.fixture.js";

/**
 * Emoji as escapes: the flags are pairs of regional indicators and the
 * subdivision flags are tag sequences, both of which a literal hides. The
 * comment is the rendered emoji.
 */
export const FLAGS = {
  france: "\u{1F1EB}\u{1F1F7}", // 🇫🇷
  uk: "\u{1F1EC}\u{1F1E7}", // 🇬🇧
  usa: "\u{1F1FA}\u{1F1F8}", // 🇺🇸
  canada: "\u{1F1E8}\u{1F1E6}", // 🇨🇦
  australia: "\u{1F1E6}\u{1F1FA}", // 🇦🇺
  germany: "\u{1F1E9}\u{1F1EA}", // 🇩🇪
  brazil: "\u{1F1E7}\u{1F1F7}", // 🇧🇷
  taiwan: "\u{1F1F9}\u{1F1FC}", // 🇹🇼
  china: "\u{1F1E8}\u{1F1F3}", // 🇨🇳
  japan: "\u{1F1EF}\u{1F1F5}", // 🇯🇵
  croatia: "\u{1F1ED}\u{1F1F7}", // 🇭🇷 — a table language Argos has no model for
  cambodia: "\u{1F1F0}\u{1F1ED}", // 🇰🇭 — a flag the table knows no language for
  england: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", // 🏴󠁧󠁢󠁥󠁮󠁧󠁿
  scotland: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}", // 🏴󠁧󠁢󠁳󠁣󠁴󠁿
} as const;

/** Reactions that must never trigger anything: two near-flags, an ordinary emoji, a custom one. */
export const NON_FLAGS = {
  rainbow: "\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}", // 🏳️‍🌈 — a white flag, not a region
  pirate: "\u{1F3F4}\u{200D}\u{2620}\u{FE0F}", // 🏴‍☠️ — a black flag with no tag sequence
  thumbsUp: "\u{1F44D}", // 👍
  custom: "blobwave", // a custom emoji reports its name
} as const;

export const AUTHOR_ID = "111111111111111111";

export interface FlagReactionOptions {
  /** The flag reacted with; defaults to 🇫🇷. */
  emoji?: string;
  /** The reacted-to message's text; `""` models an image-only post. */
  content?: string;
  /** How many people added this same reaction. */
  count?: number;
  /** Flags already on the message, emoji → count. */
  siblings?: Readonly<Record<string, number>>;
  partial?: boolean;
  messagePartial?: boolean;
  /** Make the partial fetch reject (the message went away first). */
  unreadable?: boolean;
  preferredLocale?: string;
  /** Who wrote the reacted-to message; `BOT_USER_ID` makes it one of the bot's own posts. */
  authorId?: string;
  /** `client.user` is null before the gateway is ready. */
  clientReady?: boolean;
}

export interface FakeReactedMessage extends ReactedMessage, ResponseLog {}

export interface FakeFlagReaction extends FlagReaction, ResponseLog {
  readonly message: FakeReactedMessage;
  /** What the handler had to fetch, in order: `"reaction"`, `"message"`. */
  readonly fetchCalls: string[];
}

export function makeFlagReaction(options: FlagReactionOptions = {}): FakeFlagReaction {
  const calls: ResponseLog["calls"] = [];
  const fetchCalls: string[] = [];
  const emoji = options.emoji ?? FLAGS.france;
  const count = options.count ?? 1;

  // The reaction being handled is in the message's cache like any other.
  const cache = new Map<string, ReactionSummary>([[emoji, { emoji: { name: emoji }, count }]]);
  for (const [name, siblingCount] of Object.entries(options.siblings ?? {})) {
    cache.set(name, { emoji: { name }, count: siblingCount });
  }

  const message: FakeReactedMessage = {
    calls,
    id: MESSAGE_ID,
    partial: options.messagePartial ?? false,
    content: options.content ?? SPANISH_TEXT,
    author: { id: options.authorId ?? AUTHOR_ID },
    client: { user: options.clientReady === false ? null : { id: BOT_USER_ID } },
    guild: { preferredLocale: options.preferredLocale ?? "en-US" },
    reactions: { cache },
    async fetch() {
      fetchCalls.push("message");
      if (options.unreadable) throw new Error("Unknown Message");
      return { ...message, partial: false };
    },
    async reply(payload: ReplyPayload & { allowedMentions: { repliedUser: boolean } }) {
      calls.push({ method: "reply", payload });
    },
  };

  const reaction: FakeFlagReaction = {
    calls,
    fetchCalls,
    message,
    partial: options.partial ?? false,
    emoji: { name: emoji },
    count,
    async fetch() {
      fetchCalls.push("reaction");
      if (options.unreadable) throw new Error("Unknown Message");
      return { ...reaction, partial: false };
    },
  };
  return reaction;
}

export function makeReactingUser(isBot = false): ReactingUser {
  return { bot: isBot };
}
