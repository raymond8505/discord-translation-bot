import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { translationKey } from "../cache.js";
import { makeContext } from "../fixtures/context.fixture.js";
import {
  lastReplyDescription,
  lastReplyPayload,
  makeAutocompleteInteraction,
  makeChatInputInteraction,
} from "../fixtures/interaction.fixture.js";
import { frenchMessages } from "../fixtures/messages.fixture.js";
import { sourceIdForText } from "../sourceId.js";
import { handleTranslate, handleTranslateAutocomplete, translateCommand } from "./translate.js";

describe("translateCommand", () => {
  it("declares a required text option and an autocompleted target", () => {
    const json = translateCommand.toJSON();
    expect(json.name).toBe("translate");
    expect(json.options?.map((o) => [o.name, "required" in o && o.required])).toEqual([
      ["text", true],
      ["target", false],
      ["source", false],
    ]);
  });
});

describe("handleTranslate", () => {
  it("defers ephemerally before doing any work, then replies with the translation", async () => {
    const ctx = makeContext();
    const interaction = makeChatInputInteraction({ text: "hola", locale: "en-GB" });

    await handleTranslate(ctx, interaction);

    expect(interaction.calls[0]).toEqual({ method: "deferReply", payload: { flags: MessageFlags.Ephemeral } });
    expect(lastReplyDescription(interaction)).toBe("[en] hola");
    expect(ctx.backend.translateCalls).toEqual([{ text: "hola", source: "auto", target: "en" }]);
    expect(ctx.redis.store.has(translationKey(sourceIdForText("hola"), "en"))).toBe(true);
    expect(lastReplyPayload(interaction)?.components.length).toBeGreaterThan(0);
  });

  it("honours an explicit target given as a code or a name", async () => {
    const ctx = makeContext();

    await handleTranslate(ctx, makeChatInputInteraction({ target: "ja" }));
    await handleTranslate(ctx, makeChatInputInteraction({ target: "German" }));

    expect(ctx.backend.translateCalls.map((c) => c.target)).toEqual(["ja", "de"]);
  });

  it("forces the source from the source option or a source:target in target", async () => {
    const ctx = makeContext();

    await handleTranslate(ctx, makeChatInputInteraction({ source: "french" }));
    await handleTranslate(ctx, makeChatInputInteraction({ target: "fr:de" }));
    await handleTranslate(ctx, makeChatInputInteraction({ target: "fr:", locale: "ja" }));
    await handleTranslate(ctx, makeChatInputInteraction({ target: "es:de", source: "fr" }));

    expect(ctx.backend.translateCalls.map((c) => [c.source, c.target])).toEqual([
      ["fr", "en"],
      ["fr", "de"],
      ["fr", "ja"],
      ["fr", "de"],
    ]);
  });

  it("rejects a source it cannot resolve without calling the backend", async () => {
    const ctx = makeContext();
    const interaction = makeChatInputInteraction({ source: "klingon" });

    await handleTranslate(ctx, interaction);

    expect(lastReplyDescription(interaction)).toContain("klingon");
    expect(ctx.backend.translateCalls).toHaveLength(0);
  });

  it("rejects a target it cannot resolve without calling the backend", async () => {
    const ctx = makeContext();
    const interaction = makeChatInputInteraction({ target: "klingon" });

    await handleTranslate(ctx, interaction);

    expect(lastReplyDescription(interaction)).toContain("klingon");
    expect(ctx.backend.translateCalls).toHaveLength(0);
  });

  it("replies with a notice for whitespace-only text", async () => {
    const ctx = makeContext();
    const interaction = makeChatInputInteraction({ text: "   " });

    await handleTranslate(ctx, interaction);

    expect(lastReplyDescription(interaction)).toBe("Nothing to translate.");
    expect(ctx.backend.translateCalls).toHaveLength(0);
  });

  it("speaks the user's Discord language and understands language names in it", async () => {
    const ctx = makeContext();

    const empty = makeChatInputInteraction({ text: " ", locale: "fr" });
    await handleTranslate(ctx, empty);
    expect(lastReplyDescription(empty)).toBe(frenchMessages["translate.nothing"]);

    const named = makeChatInputInteraction({ text: "hola", target: "allemand", locale: "fr" });
    await handleTranslate(ctx, named);
    expect(ctx.backend.translateCalls.map((c) => c.target)).toEqual(["de"]);
    expect(lastReplyPayload(named)?.embeds[0]?.toJSON().title).toBe(`${frenchMessages["reply.title"]} → Allemand`);
  });
});

describe("handleTranslateAutocomplete", () => {
  it("answers with nothing until the language set is warm", async () => {
    const ctx = makeContext();
    const interaction = makeAutocompleteInteraction("fr");

    await handleTranslateAutocomplete(ctx, interaction);

    expect(interaction.calls).toEqual([{ method: "respond", payload: [] }]);
  });

  it("filters by label or code, capped at 25", async () => {
    const ctx = makeContext();
    await ctx.languages.get();

    const byLabel = makeAutocompleteInteraction("chin");
    await handleTranslateAutocomplete(ctx, byLabel);
    expect(byLabel.calls[0]?.payload).toEqual([
      { name: "Chinese (Simplified)", value: "zh-Hans" },
      { name: "Chinese (Traditional)", value: "zh-Hant" },
    ]);

    const byCode = makeAutocompleteInteraction("ja");
    await handleTranslateAutocomplete(ctx, byCode);
    expect(byCode.calls[0]?.payload).toEqual([{ name: "Japanese", value: "ja" }]);

    const all = makeAutocompleteInteraction("");
    await handleTranslateAutocomplete(ctx, all);
    expect((all.calls[0]?.payload as unknown[]).length).toBeLessThanOrEqual(25);
  });

  it("offers names in the user's Discord language", async () => {
    const ctx = makeContext();
    await ctx.languages.get();

    const interaction = makeAutocompleteInteraction("allem", "fr");
    await handleTranslateAutocomplete(ctx, interaction);

    expect(interaction.calls[0]?.payload).toEqual([{ name: "Allemand", value: "de" }]);
  });
});
