import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { BackendError } from "../backends/index.js";
import { exampleSharedFlags } from "../flags.js";
import { makeFakeBackend } from "../fixtures/backend.fixture.js";
import { makeContext } from "../fixtures/context.fixture.js";
import { lastReplyDescription, lastReplyPayload, makeHelpInteraction } from "../fixtures/interaction.fixture.js";
import { makeSupported } from "../fixtures/languages.fixture.js";
import { frenchMessages } from "../fixtures/messages.fixture.js";
import { menuLanguages } from "../locale.js";
import { handleHelp, helpCommand } from "./help.js";

describe("helpCommand", () => {
  it("is a plain slash command with no options", () => {
    const json = helpCommand.toJSON();
    expect(json.name).toBe("tb-help");
    expect(json.options ?? []).toEqual([]);
  });
});

describe("handleHelp", () => {
  it("defers ephemerally, then lists every supported language with its code", async () => {
    const ctx = makeContext();
    const interaction = makeHelpInteraction();

    await handleHelp(ctx, interaction);

    expect(interaction.calls[0]).toEqual({ method: "deferReply", payload: { flags: MessageFlags.Ephemeral } });
    const description = lastReplyDescription(interaction) ?? "";
    for (const lang of menuLanguages(makeSupported())) {
      expect(description).toContain(`**${lang.label}** · \`${lang.code}\``);
    }
    expect(lastReplyPayload(interaction)?.embeds[0]?.toJSON().title).toBe("Supported languages");
    expect(lastReplyPayload(interaction)?.components).toEqual([]);
  });

  it("explains the flag reaction under the language list", async () => {
    const ctx = makeContext();
    const interaction = makeHelpInteraction();

    await handleHelp(ctx, interaction);

    const description = lastReplyDescription(interaction) ?? "";
    expect(description).toMatch(/React to a message with a country flag/);
    expect(description).toContain(exampleSharedFlags());
    expect(description.indexOf("country flag")).toBeGreaterThan(description.indexOf("**English** · `en`"));
  });

  it("names the languages and words the page in the user's Discord language", async () => {
    const ctx = makeContext();
    const interaction = makeHelpInteraction("fr");

    await handleHelp(ctx, interaction);

    expect(lastReplyPayload(interaction)?.embeds[0]?.toJSON().title).toBe(frenchMessages["help.title"]);
    expect(lastReplyDescription(interaction)).toContain("**Allemand** · `de`");
  });

  it("names the languages in a locale it has no messages of its own for", async () => {
    const ctx = makeContext();
    const interaction = makeHelpInteraction("it");

    await handleHelp(ctx, interaction);

    // No Italian message file, so the page reads English — but the list is what
    // the reader came for, and ICU names every language in Italian.
    expect(lastReplyPayload(interaction)?.embeds[0]?.toJSON().title).toBe("Supported languages");
    expect(lastReplyDescription(interaction)).toContain("**Tedesco** · `de`");
  });

  it("still explains the triggers when the backend reports no languages", async () => {
    const ctx = makeContext({ backend: makeFakeBackend({ languages: async () => [] }) });
    const interaction = makeHelpInteraction();

    await handleHelp(ctx, interaction);

    const description = lastReplyDescription(interaction) ?? "";
    expect(description).not.toMatch(/\*\*.+\*\* · `/);
    expect(description).toMatch(/@mention me/);
  });

  it("lets a backend failure reach the router after deferring", async () => {
    const ctx = makeContext({
      backend: makeFakeBackend({
        languages: async () => {
          throw new BackendError("network", "down");
        },
      }),
    });
    const interaction = makeHelpInteraction();

    await expect(handleHelp(ctx, interaction)).rejects.toBeInstanceOf(BackendError);
    expect(interaction.calls.map((c) => c.method)).toEqual(["deferReply"]);
  });
});
