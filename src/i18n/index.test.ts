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

  it("exposes the table languages", () => {
    expect([...i18n.languages].sort()).toEqual(["en", "fr", "nb", "zh-Hans"]);
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
