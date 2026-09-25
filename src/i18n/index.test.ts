import { describe, expect, it } from "vitest";
import { frenchMessages, makeMessages } from "../fixtures/messages.fixture.js";
import { createI18n, type MessageKey } from "./index.js";
import en from "./messages/en.json" with { type: "json" };
import { messages } from "./messages/index.js";
import { placeholdersOf } from "./segments.js";

const i18n = createI18n(makeMessages());

describe("createI18n", () => {
  it("serves the localized message and names the language it picked", () => {
    const tr = i18n.forLocale("fr");
    expect(tr.language).toBe("fr");
    expect(tr.t("reply.title")).toBe(frenchMessages["reply.title"]);
  });

  it("falls back to English for a key the language lacks", () => {
    expect(i18n.forLocale("fr").t("select.none")).toBe(en["select.none"]);
  });

  it("interpolates parameters and leaves unknown placeholders visible", () => {
    expect(i18n.forLocale("en-US").t("translate.unknownLanguage", { name: "klingon" })).toBe(
      'I don\'t know a language called "klingon".',
    );
    expect(i18n.forLocale("fr").t("reply.source", { language: "Anglais" })).toBe("source : Anglais");
    expect(i18n.message("en", "reply.source")).toBe("source: {language}");
  });

  it.each([
    ["en-GB", "en"],
    ["es-419", "en"],
    ["zh-TW", "zh-Hans"],
    ["no", "nb"],
    ["fr-CA", "fr"],
    ["", "en"],
    ["xx-YY", "en"],
  ])("resolves Discord locale %j to table language %s", (locale, language) => {
    expect(i18n.forLocale(locale).language).toBe(language);
  });

  it.each([
    ["en-US", "en"],
    ["", "en"],
    ["fr", "fr"],
    ["pt-BR", "pt-BR"],
    ["zh-TW", "zh-TW"],
  ])("names languages for locale %j in %s", (locale, displayLanguage) => {
    expect(i18n.forLocale(locale).displayLanguage).toBe(displayLanguage);
  });

  it("exposes the table languages", () => {
    expect([...i18n.languages].sort()).toEqual(["en", "fr", "nb", "zh-Hans"]);
  });
});

describe("forLanguage", () => {
  it("words the sentences in the language that was asked for", () => {
    const tr = i18n.forLanguage("fr");
    expect(tr.language).toBe("fr");
    expect(tr.t("reply.title")).toBe(frenchMessages["reply.title"]);
  });

  it.each([
    ["zh-Hant", "zh-Hans"],
    ["zt", "zh-Hans"],
    ["nb", "nb"],
  ])("falls back through the table's codes: %s reads %s", (code, language) => {
    expect(i18n.forLanguage(code).language).toBe(language);
  });

  it("falls back to English sentences for a language with no table", () => {
    expect(i18n.forLanguage("it").language).toBe("en");
    expect(i18n.forLanguage("xx").language).toBe("en");
  });

  it("still names languages in a language it has no sentences for", () => {
    // The whole point of the second field: no it.json exists, but ICU can name
    // every language in Italian, so the menus are Italian either way.
    expect(i18n.forLanguage("it").displayLanguage).toBe("it");
  });

  it.each([
    ["zt", "zh-Hant"],
    ["pb", "pt-BR"],
    ["en", "en"],
  ])("gives ICU a tag it accepts: %s becomes %s", (code, displayLanguage) => {
    expect(i18n.forLanguage(code).displayLanguage).toBe(displayLanguage);
  });
});

describe("generated message files", () => {
  const keys = Object.keys(en) as MessageKey[];

  it("has no empty English message", () => {
    for (const key of keys) expect(en[key], key).not.toBe("");
  });

  it.each(Object.keys(messages).filter((language) => language !== "en"))(
    "%s only has known keys, no empty values, and en's placeholders",
    (language) => {
      const table = messages[language as keyof typeof messages] as Partial<typeof en>;
      for (const [key, value] of Object.entries(table)) {
        expect(keys, `${language}: unknown key ${key}`).toContain(key);
        expect(value, `${language}.${key}`).not.toBe("");
        expect(placeholdersOf(value), `${language}.${key}`).toEqual(placeholdersOf(en[key as MessageKey]));
      }
    },
  );
});
