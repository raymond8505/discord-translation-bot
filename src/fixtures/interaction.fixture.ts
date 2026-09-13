import { MessageFlags } from "discord.js";
import type { TranslateAutocompleteInteraction, TranslateInteraction } from "../commands/translate.js";
import type { TranslateMessageInteraction } from "../commands/translateMessage.js";
import type { LanguageSelectInteraction } from "../components/languageSelect.js";
import type { ReplyPayload } from "../reply.js";

/** Records every response call so tests can assert order and payloads. */
export interface ResponseLog {
  readonly calls: Array<{ method: string; payload?: unknown }>;
}

export const MESSAGE_ID = "123456789012345678";
export const SPANISH_TEXT = "¿Hola, cómo estás?";

export interface ChatInputOptions {
  text?: string;
  target?: string | null;
  source?: string | null;
  locale?: string;
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
    options: { getString: (name) => values[name] ?? null },
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
): TranslateAutocompleteInteraction & ResponseLog {
  const calls: ResponseLog["calls"] = [];
  return {
    calls,
    options: { getFocused: () => focused },
    async respond(choices) {
      calls.push({ method: "respond", payload: choices });
    },
  };
}

export interface MessageContextOptions {
  id?: string;
  content?: string;
  locale?: string;
}

export function makeMessageContextInteraction(
  options: MessageContextOptions = {},
): TranslateMessageInteraction & ResponseLog {
  const calls: ResponseLog["calls"] = [];
  return {
    calls,
    locale: options.locale ?? "fr",
    targetMessage: { id: options.id ?? MESSAGE_ID, content: options.content ?? SPANISH_TEXT },
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
  /** Whether the menu sits on an ephemeral reply (edit in place) or a public one. */
  onEphemeral?: boolean;
  /** What `channel.messages.fetch` returns; `null` models a deleted message (fetch throws). */
  channelMessage?: { content: string } | null;
  /** `channel: null` models an interaction with no channel to fetch from. */
  withoutChannel?: boolean;
}

export function makeSelectInteraction(options: SelectOptions): LanguageSelectInteraction & ResponseLog {
  const calls: ResponseLog["calls"] = [];
  const channelMessage = options.channelMessage;
  return {
    calls,
    customId: options.customId,
    values: options.value === undefined ? ["fr"] : [options.value],
    message: {
      flags: { has: (flag) => flag === MessageFlags.Ephemeral && (options.onEphemeral ?? true) },
    },
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
        },
    async deferUpdate() {
      calls.push({ method: "deferUpdate" });
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
