import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { sourceKey } from "../cache.js";
import { makeContext } from "../fixtures/context.fixture.js";
import { MESSAGE_ID, lastReplyDescription, makeSelectInteraction } from "../fixtures/interaction.fixture.js";
import { makeFakeRedis } from "../fixtures/redis.fixture.js";
import { sourceIdForText } from "../sourceId.js";
import { buildSelectCustomId } from "./customId.js";
import { handleLanguageSelect } from "./languageSelect.js";

const customId = buildSelectCustomId(0, MESSAGE_ID);

describe("handleLanguageSelect", () => {
  it("edits an ephemeral reply in place", async () => {
    const ctx = makeContext({ redis: makeFakeRedis({ [sourceKey(MESSAGE_ID)]: "hola" }) });
    const interaction = makeSelectInteraction({ customId, value: "de", onEphemeral: true });

    await handleLanguageSelect(ctx, interaction);

    expect(interaction.calls[0]).toEqual({ method: "deferUpdate" });
    expect(lastReplyDescription(interaction)).toBe("[de] hola");
    expect(ctx.backend.translateCalls[0]?.target).toBe("de");
  });

  it("answers a menu on a public reply with a fresh ephemeral message", async () => {
    const ctx = makeContext({ redis: makeFakeRedis({ [sourceKey(MESSAGE_ID)]: "hola" }) });
    const interaction = makeSelectInteraction({ customId, value: "de", onEphemeral: false });

    await handleLanguageSelect(ctx, interaction);

    expect(interaction.calls[0]).toEqual({ method: "deferReply", payload: { flags: MessageFlags.Ephemeral } });
    expect(lastReplyDescription(interaction)).toBe("[de] hola");
  });

  it("re-fetches the message when the stored source has expired", async () => {
    const ctx = makeContext();
    const interaction = makeSelectInteraction({ customId, channelMessage: { content: "buenos días" } });

    await handleLanguageSelect(ctx, interaction);

    expect(interaction.calls.some((c) => c.method === "fetch" && c.payload === MESSAGE_ID)).toBe(true);
    expect(lastReplyDescription(interaction)).toBe("[fr] buenos días");
  });

  it("reports expiry when the source is gone and cannot be re-fetched", async () => {
    const ctx = makeContext();

    const deleted = makeSelectInteraction({ customId, channelMessage: null });
    await handleLanguageSelect(ctx, deleted);
    expect(lastReplyDescription(deleted)).toMatch(/no longer available/);

    const freeText = makeSelectInteraction({ customId: buildSelectCustomId(0, sourceIdForText("x")) });
    await handleLanguageSelect(ctx, freeText);
    expect(lastReplyDescription(freeText)).toMatch(/no longer available/);
    expect(freeText.calls.some((c) => c.method === "fetch")).toBe(false);

    const noChannel = makeSelectInteraction({ customId, withoutChannel: true });
    await handleLanguageSelect(ctx, noChannel);
    expect(lastReplyDescription(noChannel)).toMatch(/no longer available/);

    expect(ctx.backend.translateCalls).toHaveLength(0);
  });

  it("falls back to a fetch when Redis itself fails", async () => {
    const redis = makeFakeRedis();
    redis.get = async () => {
      throw new Error("ECONNREFUSED");
    };
    const ctx = makeContext({ redis });
    const interaction = makeSelectInteraction({ customId, channelMessage: { content: "hola" } });

    await handleLanguageSelect(ctx, interaction);

    expect(lastReplyDescription(interaction)).toBe("[fr] hola");
  });

  it("ignores a customId it did not build", async () => {
    const ctx = makeContext();
    const interaction = makeSelectInteraction({ customId: "other:0:123" });

    await handleLanguageSelect(ctx, interaction);

    expect(interaction.calls).toEqual([]);
    expect(ctx.log.entries[0]?.level).toBe("warn");
  });
});
