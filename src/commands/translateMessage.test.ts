import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { sourceKey, translationKey } from "../cache.js";
import { makeContext } from "../fixtures/context.fixture.js";
import {
  MESSAGE_ID,
  SPANISH_TEXT,
  lastReplyDescription,
  makeMessageContextInteraction,
} from "../fixtures/interaction.fixture.js";
import { frenchMessages } from "../fixtures/messages.fixture.js";
import { handleTranslateMessage, translateMessageCommand } from "./translateMessage.js";

describe("translateMessageCommand", () => {
  it("is a message context-menu command", () => {
    expect(translateMessageCommand.toJSON()).toMatchObject({ name: "Translate Message", type: 3 });
  });
});

describe("handleTranslateMessage", () => {
  it("defers ephemerally and translates the target message into the user's locale", async () => {
    const ctx = makeContext();
    const interaction = makeMessageContextInteraction({ locale: "fr" });

    await handleTranslateMessage(ctx, interaction);

    expect(interaction.calls[0]).toEqual({ method: "deferReply", payload: { flags: MessageFlags.Ephemeral } });
    expect(ctx.backend.translateCalls).toEqual([{ text: SPANISH_TEXT, source: "auto", target: "fr" }]);
    expect(lastReplyDescription(interaction)).toBe(`[fr] ${SPANISH_TEXT}`);
  });

  it("caches under the message id so edits and deletes can invalidate it", async () => {
    const ctx = makeContext();

    await handleTranslateMessage(ctx, makeMessageContextInteraction({ id: MESSAGE_ID, locale: "de" }));

    expect(ctx.redis.store.has(translationKey(MESSAGE_ID, "de"))).toBe(true);
    expect(ctx.redis.store.get(sourceKey(MESSAGE_ID))?.value).toBe(SPANISH_TEXT);
  });

  it("replies with a notice when the message has no text", async () => {
    const ctx = makeContext();
    const interaction = makeMessageContextInteraction({ content: "", locale: "en-US" });

    await handleTranslateMessage(ctx, interaction);

    expect(lastReplyDescription(interaction)).toBe("That message has no text to translate.");
    expect(ctx.backend.translateCalls).toHaveLength(0);
  });

  it("words the notice in the user's Discord language", async () => {
    const ctx = makeContext();
    const interaction = makeMessageContextInteraction({ content: "", locale: "fr" });

    await handleTranslateMessage(ctx, interaction);

    expect(lastReplyDescription(interaction)).toBe(frenchMessages["translate.noText"]);
  });
});
