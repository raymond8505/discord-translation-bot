import { Locale } from "discord.js";
import { describe, expect, it } from "vitest";
import { frenchMessages, makeMessages } from "../fixtures/messages.fixture.js";
import { COMMAND_DESCRIPTION_MAX, COMMAND_NAME_MAX, localizationsFor } from "./discord.js";
import { createI18n, type MessageKey } from "./index.js";
import en from "./messages/en.json" with { type: "json" };

const i18n = createI18n(makeMessages());

describe("localizationsFor", () => {
  it("maps every Discord locale that resolves to a translated message", () => {
    expect(localizationsFor("reply.title", COMMAND_DESCRIPTION_MAX, undefined, i18n)).toEqual({
      fr: frenchMessages["reply.title"],
      "zh-CN": "翻译",
      "zh-TW": "翻译",
      no: "Oversettelse",
    });
  });

  it("leaves out locales that would only repeat the English wording", () => {
    expect(localizationsFor("select.none", COMMAND_DESCRIPTION_MAX, undefined, i18n)).toEqual({});
  });

  it("leaves out a value over Discord's limit rather than crash the builder", () => {
    const short = localizationsFor("mention.hint", 20, undefined, i18n);
    expect(short).toEqual({});
    expect(frenchMessages["mention.hint"].length).toBeGreaterThan(20);
  });

  it("interpolates parameters before comparing and measuring", () => {
    const map = localizationsFor("translate.unknownLanguage", COMMAND_DESCRIPTION_MAX, { name: "klingon" }, i18n);
    expect(map.fr).toBe('Je ne connais pas de langue appelée « klingon ».');
  });

  it("only ever emits keys Discord knows, within the name and description limits", () => {
    const locales = new Set<string>(Object.values(Locale));
    for (const key of Object.keys(en) as MessageKey[]) {
      for (const [locale, value] of Object.entries(localizationsFor(key, COMMAND_NAME_MAX))) {
        expect(locales.has(locale), `${key}: ${locale}`).toBe(true);
        expect(value?.length ?? 0, `${key}: ${locale}`).toBeLessThanOrEqual(COMMAND_NAME_MAX);
      }
    }
  });
});
