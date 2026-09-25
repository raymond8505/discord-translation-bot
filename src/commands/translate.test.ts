import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { translationKey } from "../cache.js";
import { lastPostFlags } from "../fixtures/interaction.fixture.js";
import { alwaysLimited, makeContext } from "../fixtures/context.fixture.js";
import {
  lastPostDescription,
  lastPostPayload,
  lastReplyDescription,
  typedBeforePosting,
  makeAutocompleteInteraction,
  makeChatInputInteraction,
} from "../fixtures/interaction.fixture.js";
import { frenchMessages } from "../fixtures/messages.fixture.js";
import { contentHash } from "../sourceId.js";
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

  it("fills the colon form into the target description rather than leaving a placeholder", () => {
    const target = translateCommand.toJSON().options?.find((o) => o.name === "target");
    expect(target?.description).toContain("source:target");
    expect(target?.description).not.toContain("{");
    expect(target?.description_localizations).toBeDefined();
  });
});

describe("handleTranslate", () => {
  it("defers ephemerally before doing any work, then posts the translation to the channel", async () => {
    const ctx = makeContext();
    const interaction = makeChatInputInteraction({ text: "hola", locale: "en-GB" });

    await handleTranslate(ctx, interaction);

    expect(interaction.calls[0]).toEqual({ method: "deferReply", payload: { flags: MessageFlags.Ephemeral } });
    expect(lastPostDescription(interaction)).toBe("[en] hola");
    expect(lastReplyDescription(interaction)).toBe("Posted the translation in the channel.");
    // The invoker sees the defer; the channel sees the bot working.
    expect(typedBeforePosting(interaction)).toBe(true);
    expect(ctx.backend.translateCalls).toEqual([{ text: "hola", source: "auto", target: "en" }]);
    expect(ctx.redis.store.has(translationKey(contentHash("hola"), "auto", "en"))).toBe(true);
    expect(lastPostPayload(interaction)?.components.length).toBeGreaterThan(0);
  });

  it("keeps the translation in the ephemeral reply when there is no channel to post to", async () => {
    const ctx = makeContext();
    const interaction = makeChatInputInteraction({ text: "hola", withoutChannel: true });

    await handleTranslate(ctx, interaction);

    expect(lastReplyDescription(interaction)).toBe("[en] hola");
    expect(interaction.calls.some((call) => call.method === "send")).toBe(false);
  });

  it("records nothing for free text, which has no message an edit could change", async () => {
    const ctx = makeContext();

    await handleTranslate(ctx, makeChatInputInteraction({ text: "hola" }));

    const recorded = [...ctx.redis.store.keys()].filter((key) => key.startsWith("post:"));
    expect(recorded).toEqual([]);
  });

  it("honours an explicit target given as a code or a name", async () => {
    const ctx = makeContext();

    await handleTranslate(ctx, makeChatInputInteraction({ target: "ja" }));
    await handleTranslate(ctx, makeChatInputInteraction({ target: "German" }));

    expect(ctx.backend.translateCalls.map((c) => c.target)).toEqual(["ja", "de"]);
  });

  it("forces the source from the source option or a source:target in target", async () => {
    const ctx = makeContext();

    // All four steps translate the same default text over one ctx, so their
    // targets must differ: the cache is keyed by content, and a repeat of a
    // (source, target) pair would be served from it and never reach the fake.
    await handleTranslate(ctx, makeChatInputInteraction({ source: "french" }));
    await handleTranslate(ctx, makeChatInputInteraction({ target: "fr:de" }));
    await handleTranslate(ctx, makeChatInputInteraction({ target: "fr:", locale: "ja" }));
    await handleTranslate(ctx, makeChatInputInteraction({ target: "es:it", source: "fr" }));

    expect(ctx.backend.translateCalls.map((c) => [c.source, c.target])).toEqual([
      ["fr", "en"],
      ["fr", "de"],
      ["fr", "ja"],
      ["fr", "it"],
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
    expect(lastPostPayload(named)?.embeds[0]?.toJSON().title).toBe(`${frenchMessages["reply.title"]} → Allemand`);
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

  it("refuses with an ephemeral notice when rate limited, naming the wait", async () => {
    const ctx = makeContext({ rateLimiter: alwaysLimited("user", 42) });
    const interaction = makeChatInputInteraction();

    await handleTranslate(ctx, interaction);

    // Ephemeral, so unlike the public triggers a notice here cannot become the
    // flood: only the person who asked ever sees it.
    expect(lastReplyDescription(interaction)).toContain("42");
    expect(ctx.backend.translateCalls).toEqual([]);
  });

  it("does not name a wait on the guild budget", async () => {
    const ctx = makeContext({ rateLimiter: alwaysLimited("guild", 2_400) });
    const interaction = makeChatInputInteraction();

    await handleTranslate(ctx, interaction);

    // "Try again in 40 minutes" reads as a fault and the reader cannot act on
    // it anyway; it is someone else's usage they are waiting on.
    expect(lastReplyDescription(interaction)).not.toContain("2400");
    expect(ctx.backend.translateCalls).toEqual([]);
  });

  it("posts silently into a thread, and normally outside one", async () => {
    const ctx = makeContext();

    const thread = makeChatInputInteraction({ text: "hola", target: "ja", inThread: true });
    await handleTranslate(ctx, thread);
    expect(lastPostFlags(thread)).toBe(MessageFlags.SuppressNotifications);

    const channel = makeChatInputInteraction({ text: "hola", target: "de" });
    await handleTranslate(ctx, channel);
    expect(lastPostFlags(channel)).toBeUndefined();
  });

});
