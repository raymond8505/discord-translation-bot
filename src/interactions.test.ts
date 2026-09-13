import { MessageFlags, type Interaction } from "discord.js";
import { describe, expect, it } from "vitest";
import { BackendError } from "./backends/index.js";
import { buildSelectCustomId } from "./components/customId.js";
import { makeFakeBackend } from "./fixtures/backend.fixture.js";
import { makeContext } from "./fixtures/context.fixture.js";
import {
  MESSAGE_ID,
  lastReplyDescription,
  makeChatInputInteraction,
  makeHelpInteraction,
  makeMessageContextInteraction,
  makeSelectInteraction,
  type ResponseLog,
} from "./fixtures/interaction.fixture.js";
import { frenchMessages } from "./fixtures/messages.fixture.js";
import { createInteractionHandler } from "./interactions.js";
import type { ReplyPayload } from "./reply.js";

type Kind = "chat" | "context" | "autocomplete" | "select";

/**
 * Wraps a handler-level fake in the type-guard surface `route()` relies on.
 * `deferred`/`replied` are tracked from the recorded calls so the error path
 * picks editReply vs reply the way a real interaction would.
 */
function asInteraction(kind: Kind, fake: ResponseLog & object, extra: Record<string, unknown> = {}): Interaction {
  const calls = fake.calls;
  const stub = {
    ...fake,
    ...extra,
    isChatInputCommand: () => kind === "chat",
    isMessageContextMenuCommand: () => kind === "context",
    isAutocomplete: () => kind === "autocomplete",
    isStringSelectMenu: () => kind === "select",
    isRepliable: () => kind !== "autocomplete",
    get deferred() {
      return calls.some((c) => c.method === "deferReply" || c.method === "deferUpdate");
    },
    get replied() {
      return calls.some((c) => c.method === "reply");
    },
    async reply(payload: unknown) {
      calls.push({ method: "reply", payload });
    },
  };
  return stub as unknown as Interaction;
}

function lastNotice(fake: ResponseLog): { method: string; text?: string; flags?: unknown } | undefined {
  const last = fake.calls[fake.calls.length - 1];
  if (!last) return undefined;
  const payload = last.payload as (ReplyPayload & { flags?: unknown }) | undefined;
  return { method: last.method, text: payload?.embeds?.[0]?.toJSON().description, flags: payload?.flags };
}

describe("createInteractionHandler", () => {
  it("routes the slash command, the context command and the select menu", async () => {
    const ctx = makeContext();
    const handle = createInteractionHandler(ctx);
    const chat = makeChatInputInteraction({ text: "hola" });
    const context = makeMessageContextInteraction();
    // "de" so the select misses the cache the context command just filled for "fr".
    const select = makeSelectInteraction({
      customId: buildSelectCustomId({ role: "target", menuIndex: 0, other: "auto", sourceId: MESSAGE_ID }),
      value: "de",
      channelMessage: { content: "hola" },
    });

    await handle(asInteraction("chat", chat, { commandName: "translate" }));
    await handle(asInteraction("context", context, { commandName: "Translate Message" }));
    await handle(asInteraction("select", select));

    expect(ctx.backend.translateCalls).toHaveLength(3);
    expect(chat.calls.at(-1)?.method).toBe("editReply");
    expect(context.calls.at(-1)?.method).toBe("editReply");
    expect(select.calls.at(-1)?.method).toBe("editReply");
  });

  it("routes /help", async () => {
    const ctx = makeContext();
    const help = makeHelpInteraction();

    await createInteractionHandler(ctx)(asInteraction("chat", help, { commandName: "help" }));

    expect(lastReplyDescription(help)).toContain("`fr`");
    expect(ctx.backend.translateCalls).toHaveLength(0);
  });

  it("logs and ignores commands it does not know", async () => {
    const ctx = makeContext();
    const chat = makeChatInputInteraction();

    await createInteractionHandler(ctx)(asInteraction("chat", chat, { commandName: "ping" }));

    expect(chat.calls).toEqual([]);
    expect(ctx.log.entries[0]).toMatchObject({ level: "warn" });
  });

  it("turns a backend failure after deferral into an edited notice", async () => {
    const backend = makeFakeBackend({
      translate: async () => {
        throw new BackendError("timeout", "slow");
      },
    });
    const ctx = makeContext({ backend });
    const chat = makeChatInputInteraction();

    await createInteractionHandler(ctx)(asInteraction("chat", chat, { commandName: "translate" }));

    expect(lastNotice(chat)).toMatchObject({ method: "editReply", text: expect.stringMatching(/too long/) });
    expect(ctx.log.entries.some((e) => e.level === "warn")).toBe(true);
  });

  it("replies ephemerally when a failure happens before any deferral", async () => {
    const ctx = makeContext();
    const chat = makeChatInputInteraction();
    chat.deferReply = async () => {
      throw new TypeError("gateway hiccup");
    };

    await createInteractionHandler(ctx)(asInteraction("chat", chat, { commandName: "translate" }));

    expect(lastNotice(chat)).toMatchObject({
      method: "reply",
      text: expect.stringMatching(/Something went wrong/),
      flags: MessageFlags.Ephemeral,
    });
    expect(ctx.log.entries.some((e) => e.level === "error")).toBe(true);
  });

  it("words the error notice in the user's Discord language", async () => {
    const ctx = makeContext();
    const chat = makeChatInputInteraction({ locale: "fr" });
    chat.deferReply = async () => {
      throw new TypeError("gateway hiccup");
    };

    await createInteractionHandler(ctx)(asInteraction("chat", chat, { commandName: "translate" }));

    expect(lastNotice(chat)?.text).toBe(frenchMessages["error.generic"]);
  });

  it("never throws even when the error notice itself cannot be delivered", async () => {
    const ctx = makeContext();
    const chat = makeChatInputInteraction();
    chat.deferReply = async () => {
      throw new Error("boom");
    };
    const interaction = asInteraction("chat", chat, { commandName: "translate" });
    (interaction as unknown as { reply: () => Promise<never> }).reply = async () => {
      throw new Error("also boom");
    };

    await expect(createInteractionHandler(ctx)(interaction)).resolves.toBeUndefined();
    expect(ctx.log.entries.filter((e) => e.level === "error")).toHaveLength(2);
  });
});
