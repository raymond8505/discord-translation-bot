import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { sourceKey } from "../cache.js";
import { alwaysLimited, makeContext } from "../fixtures/context.fixture.js";
import { MESSAGE_ID, lastReplyDescription, lastReplyPayload, makeSelectInteraction } from "../fixtures/interaction.fixture.js";
import { frenchMessages } from "../fixtures/messages.fixture.js";
import { makeFakeRedis } from "../fixtures/redis.fixture.js";
import { sourceIdForText } from "../sourceId.js";
import { buildSelectCustomId, parseSelectCustomId } from "./customId.js";
import { handleLanguageSelect } from "./languageSelect.js";

const targetMenu = buildSelectCustomId({ role: "target", menuIndex: 0, other: "auto", sourceId: MESSAGE_ID });
const sourceMenu = buildSelectCustomId({ role: "source", menuIndex: 0, other: "en", sourceId: MESSAGE_ID });

function withSource(text: string) {
  return makeFakeRedis({ [sourceKey(MESSAGE_ID)]: text });
}

describe("handleLanguageSelect", () => {
  it("edits an ephemeral reply in place when a target is picked", async () => {
    const ctx = makeContext({ redis: withSource("hola") });
    const interaction = makeSelectInteraction({ customId: targetMenu, value: "de", onEphemeral: true });

    await handleLanguageSelect(ctx, interaction);

    expect(interaction.calls[0]).toEqual({ method: "deferUpdate" });
    expect(lastReplyDescription(interaction)).toBe("[de] hola");
    expect(ctx.backend.translateCalls).toEqual([{ text: "hola", source: "auto", target: "de" }]);
  });

  it("answers a menu on a public reply with a fresh ephemeral message", async () => {
    const ctx = makeContext({ redis: withSource("hola") });
    const interaction = makeSelectInteraction({ customId: targetMenu, value: "de", onEphemeral: false });

    await handleLanguageSelect(ctx, interaction);

    expect(interaction.calls[0]).toEqual({ method: "deferReply", payload: { flags: MessageFlags.Ephemeral } });
    expect(lastReplyDescription(interaction)).toBe("[de] hola");
  });

  it("forces the source from a source menu and keeps the target", async () => {
    const ctx = makeContext({ redis: withSource("j'adore") });
    const interaction = makeSelectInteraction({ customId: sourceMenu, value: "fr" });

    await handleLanguageSelect(ctx, interaction);

    expect(ctx.backend.translateCalls).toEqual([{ text: "j'adore", source: "fr", target: "en" }]);
    // The new reply's target menus now carry the forced source.
    const ids = lastReplyPayload(interaction)?.components.map((row) => parseSelectCustomId(row.toJSON().components[0]?.custom_id ?? ""));
    expect(ids?.filter((id) => id?.role === "target").every((id) => id?.other === "fr")).toBe(true);
  });

  it("returns to auto-detection when the source menu's Auto option is picked", async () => {
    const ctx = makeContext({ redis: withSource("hola") });
    const interaction = makeSelectInteraction({ customId: sourceMenu, value: "auto" });

    await handleLanguageSelect(ctx, interaction);

    expect(ctx.backend.translateCalls).toEqual([{ text: "hola", source: "auto", target: "en" }]);
  });

  it("keeps a forced source when a target is picked afterwards", async () => {
    const ctx = makeContext({ redis: withSource("j'adore") });
    const forcedTarget = buildSelectCustomId({ role: "target", menuIndex: 0, other: "fr", sourceId: MESSAGE_ID });

    await handleLanguageSelect(ctx, makeSelectInteraction({ customId: forcedTarget, value: "de" }));

    expect(ctx.backend.translateCalls).toEqual([{ text: "j'adore", source: "fr", target: "de" }]);
  });

  it("re-fetches the message when the stored source has expired", async () => {
    const ctx = makeContext();
    const interaction = makeSelectInteraction({ customId: targetMenu, channelMessage: { content: "buenos días" } });

    await handleLanguageSelect(ctx, interaction);

    expect(interaction.calls.some((c) => c.method === "fetch" && c.payload === MESSAGE_ID)).toBe(true);
    expect(lastReplyDescription(interaction)).toBe("[fr] buenos días");
  });

  it("reports expiry when the source is gone and cannot be re-fetched", async () => {
    const ctx = makeContext();

    const deleted = makeSelectInteraction({ customId: targetMenu, channelMessage: null });
    await handleLanguageSelect(ctx, deleted);
    expect(lastReplyDescription(deleted)).toMatch(/no longer available/);

    const freeText = makeSelectInteraction({
      customId: buildSelectCustomId({ role: "target", menuIndex: 0, other: "auto", sourceId: sourceIdForText("x") }),
    });
    await handleLanguageSelect(ctx, freeText);
    expect(lastReplyDescription(freeText)).toMatch(/no longer available/);
    expect(freeText.calls.some((c) => c.method === "fetch")).toBe(false);

    const noChannel = makeSelectInteraction({ customId: targetMenu, withoutChannel: true });
    await handleLanguageSelect(ctx, noChannel);
    expect(lastReplyDescription(noChannel)).toMatch(/no longer available/);

    expect(ctx.backend.translateCalls).toHaveLength(0);
  });

  it("words the expiry notice in the clicker's Discord language", async () => {
    const ctx = makeContext();
    const deleted = makeSelectInteraction({ customId: targetMenu, channelMessage: null, locale: "fr" });

    await handleLanguageSelect(ctx, deleted);

    expect(lastReplyDescription(deleted)).toBe(frenchMessages["select.expired"]);
  });

  it("falls back to a fetch when Redis itself fails", async () => {
    const redis = makeFakeRedis();
    redis.get = async () => {
      throw new Error("ECONNREFUSED");
    };
    const ctx = makeContext({ redis });
    const interaction = makeSelectInteraction({ customId: targetMenu, channelMessage: { content: "hola" } });

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

  it("refuses a menu pick when rate limited", async () => {
    const ctx = makeContext({ rateLimiter: alwaysLimited("user", 9) });
    const interaction = makeSelectInteraction({ customId: `lang:t:0:auto:${MESSAGE_ID}` });

    await handleLanguageSelect(ctx, interaction);

    // Menus on a public reply are clickable by anyone in the channel, which
    // makes this the cheapest surface to hammer.
    expect(lastReplyDescription(interaction)).toContain("9");
    expect(ctx.backend.translateCalls).toEqual([]);
  });
});
