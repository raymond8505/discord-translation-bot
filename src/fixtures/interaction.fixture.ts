import type { HelpInteraction } from "../commands/help.js";
import type { TranslateAutocompleteInteraction, TranslateInteraction } from "../commands/translate.js";
import type { TranslateMessageInteraction } from "../commands/translateMessage.js";
import type { LanguageSelectInteraction } from "../components/languageSelect.js";
import type { PostedMessage } from "../publish.js";
import type { ReplyPayload } from "../reply.js";
import { CHANNEL_ID, makePostedMessages } from "./post.fixture.js";

/** Records every response call so tests can assert order and payloads. */
export interface ResponseLog {
  readonly calls: Array<{ method: string; payload?: unknown }>;
}

export const MESSAGE_ID = "123456789012345678";
export const SPANISH_TEXT = "¿Hola, cómo estás?";
/** The actor behind every interaction fixture, for rate-limit assertions. */
export const USER_ID = "222222222222222222";
export const GUILD_ID = "876543210987654321";

/** `channel.send`: records the public post and answers as Discord would, with the sent message. */
function makeSend(calls: ResponseLog["calls"]): (payload: ReplyPayload) => Promise<PostedMessage> {
  const posted = makePostedMessages();
  return async (payload) => {
    calls.push({ method: "send", payload });
    return posted();
  };
}

/** `targetMessage.reply`: the context menu's public post, quiet like the other triggers. */
function makeReply(
  calls: ResponseLog["calls"],
): (options: ReplyPayload & { allowedMentions: { repliedUser: boolean } }) => Promise<PostedMessage> {
  const posted = makePostedMessages();
  return async (payload) => {
    calls.push({ method: "reply", payload });
    return posted();
  };
}

export interface ChatInputOptions {
  text?: string;
  target?: string | null;
  source?: string | null;
  locale?: string;
  userId?: string;
  /** `null` models a DM, where there is no guild budget to spend. */
  guildId?: string | null;
  /** Models a channel the translation cannot be posted to, leaving only the ephemeral reply. */
  withoutChannel?: boolean;
}

export function makeChatInputInteraction(
  options: ChatInputOptions = {},
): TranslateInteraction & ResponseLog {
  const calls: ResponseLog["calls"] = [];
  const values: Record<string, string | null> = {
    text: options.text ?? SPANISH_TEXT,
    target: options.target ?? null,
    source: options.source ?? null,
  };
  return {
    calls,
    locale: options.locale ?? "en-US",
    user: { id: options.userId ?? USER_ID },
    guildId: options.guildId === undefined ? GUILD_ID : options.guildId,
    options: { getString: (name) => values[name] ?? null },
    channel: options.withoutChannel ? null : { id: CHANNEL_ID, send: makeSend(calls) },
    async deferReply(payload) {
      calls.push({ method: "deferReply", payload });
    },
    async editReply(payload: ReplyPayload) {
      calls.push({ method: "editReply", payload });
    },
  };
}

export function makeAutocompleteInteraction(
  focused: string,
  locale = "en-US",
): TranslateAutocompleteInteraction & ResponseLog {
  const calls: ResponseLog["calls"] = [];
  return {
    calls,
    locale,
    options: { getFocused: () => focused },
    async respond(choices) {
      calls.push({ method: "respond", payload: choices });
    },
  };
}

export function makeHelpInteraction(locale = "en-US"): HelpInteraction & ResponseLog {
  const calls: ResponseLog["calls"] = [];
  return {
    calls,
    locale,
    async deferReply(payload) {
      calls.push({ method: "deferReply", payload });
    },
    async editReply(payload: ReplyPayload) {
      calls.push({ method: "editReply", payload });
    },
  };
}

export interface MessageContextOptions {
  id?: string;
  content?: string;
  locale?: string;
  userId?: string;
  guildId?: string | null;
}

export function makeMessageContextInteraction(
  options: MessageContextOptions = {},
): TranslateMessageInteraction & ResponseLog {
  const calls: ResponseLog["calls"] = [];
  return {
    calls,
    locale: options.locale ?? "fr",
    user: { id: options.userId ?? USER_ID },
    guildId: options.guildId === undefined ? GUILD_ID : options.guildId,
    targetMessage: {
      id: options.id ?? MESSAGE_ID,
      content: options.content ?? SPANISH_TEXT,
      reply: makeReply(calls),
    },
    async deferReply(payload) {
      calls.push({ method: "deferReply", payload });
    },
    async editReply(payload: ReplyPayload) {
      calls.push({ method: "editReply", payload });
    },
  };
}

export interface SelectOptions {
  customId: string;
  value?: string;
  /** What `channel.messages.fetch` returns; `null` models a deleted message (fetch throws). */
  channelMessage?: { content: string } | null;
  /** `channel: null` models an interaction with no channel to fetch from. */
  withoutChannel?: boolean;
  locale?: string;
  userId?: string;
  guildId?: string | null;
}

export function makeSelectInteraction(options: SelectOptions): LanguageSelectInteraction & ResponseLog {
  const calls: ResponseLog["calls"] = [];
  const channelMessage = options.channelMessage;
  return {
    calls,
    locale: options.locale ?? "en-US",
    user: { id: options.userId ?? USER_ID },
    guildId: options.guildId === undefined ? GUILD_ID : options.guildId,
    customId: options.customId,
    values: options.value === undefined ? ["fr"] : [options.value],
    channel: options.withoutChannel
      ? null
      : {
          messages: {
            async fetch(id) {
              calls.push({ method: "fetch", payload: id });
              if (!channelMessage) throw new Error("Unknown Message");
              return channelMessage;
            },
          },
          send: makeSend(calls),
        },
    async deferReply(payload) {
      calls.push({ method: "deferReply", payload });
    },
    async editReply(payload: ReplyPayload) {
      calls.push({ method: "editReply", payload });
    },
  };
}

/** The embed description of the last `editReply`/`reply`, for terse assertions. */
export function lastReplyDescription(log: ResponseLog): string | undefined {
  const last = [...log.calls].reverse().find((c) => c.method === "editReply" || c.method === "reply");
  const payload = last?.payload as ReplyPayload | undefined;
  return payload?.embeds[0]?.toJSON().description;
}

export function lastReplyPayload(log: ResponseLog): ReplyPayload | undefined {
  const last = [...log.calls].reverse().find((c) => c.method === "editReply" || c.method === "reply");
  return last?.payload as ReplyPayload | undefined;
}

/** What actually landed in the channel: a `send`, or the `reply` the message triggers post. */
export function lastPostPayload(log: ResponseLog): ReplyPayload | undefined {
  const last = [...log.calls].reverse().find((c) => c.method === "send" || c.method === "reply");
  return last?.payload as ReplyPayload | undefined;
}

export function lastPostDescription(log: ResponseLog): string | undefined {
  return lastPostPayload(log)?.embeds[0]?.toJSON().description;
}
