import { describe, expect, it } from "vitest";
import { makeSupported, primaryOnlyCodes } from "./fixtures/languages.fixture.js";
import {
  LANGUAGES,
  labelFor,
  menuLanguages,
  displayLanguageForLocale,
  icuLanguageFor,
  parseLanguageHint,
  parseLanguageSpec,
  resolveTarget,
} from "./locale.js";

const supported = makeSupported();
const primaryOnly = makeSupported(primaryOnlyCodes);

describe("LANGUAGES table", () => {
  it("covers every Discord locale exactly once", () => {
    const discordLocales = [
      "id", "da", "de", "en-GB", "en-US", "es-ES", "es-419", "fr", "hr", "it",
      "lt", "hu", "nl", "no", "pl", "pt-BR", "ro", "fi", "sv-SE", "vi", "tr",
      "cs", "el", "bg", "ru", "uk", "hi", "th", "zh-CN", "ja", "zh-TW", "ko",
    ];
    const listed = LANGUAGES.flatMap((def) => def.locales);
    expect([...listed].sort()).toEqual([...discordLocales].sort());
  });
});

describe("resolveTarget", () => {
  it.each([
    ["en-US", "en"],
    ["en-GB", "en"],
    ["es-419", "es"],
    ["zh-CN", "zh-Hans"],
    ["sv-SE", "sv"],
    ["pt-BR", "pt-BR"],
  ])("maps %s to %s", (locale, code) => {
    expect(resolveTarget(locale, supported)).toBe(code);
  });

  it("prefers the backend's specific code when it has it", () => {
    expect(resolveTarget("zh-TW", supported)).toBe("zh-Hant");
    expect(resolveTarget("no", supported)).toBe("nb");
  });

  it("falls back to the next candidate when the specific code is missing", () => {
    expect(resolveTarget("zh-TW", primaryOnly)).toBe("zh");
    expect(resolveTarget("zh-CN", primaryOnly)).toBe("zh");
    expect(resolveTarget("pt-BR", primaryOnly)).toBe("pt");
  });

  it("uses the bare prefix for a locale the table does not know", () => {
    expect(resolveTarget("de-CH", supported)).toBe("de");
  });

  it("falls back to English when nothing is supported", () => {
    expect(resolveTarget("hr", supported)).toBe("en");
    expect(resolveTarget("xx-YY", supported)).toBe("en");
    expect(resolveTarget("", supported)).toBe("en");
  });

  it("is case-insensitive", () => {
    expect(resolveTarget("EN-us", supported)).toBe("en");
  });
});

describe("menuLanguages", () => {
  it("lists only backend-supported entries, sorted by label", () => {
    const menu = menuLanguages(supported);
    const labels = menu.map((m) => m.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
    expect(labels).not.toContain("Croatian");
    expect(labels).not.toContain("Lithuanian");
    expect(menu).toContainEqual({ code: "zh-Hant", label: "Chinese (Traditional)" });
    expect(menu).toContainEqual({ code: "pt", label: "Portuguese" });
    expect(menu).toContainEqual({ code: "pt-BR", label: "Portuguese (Brazil)" });
  });

  it("drops an entry whose fallback collapses onto a listed code", () => {
    const menu = menuLanguages(primaryOnly);
    expect(menu.filter((m) => m.code === "zh")).toHaveLength(1);
    expect(menu.filter((m) => m.code === "pt")).toHaveLength(1);
    expect(menu.map((m) => m.label)).not.toContain("Chinese (Traditional)");
    expect(menu.map((m) => m.label)).not.toContain("Portuguese (Brazil)");
  });

  it("never throws for a language ICU cannot parse", () => {
    // The names are guarded inside displayLabel; the sort's own localeCompare is
    // not, and the reader's language now comes from a flag or a customId.
    for (const uiLang of ["auto", "", "t_0123456789abcdef", "not a locale"]) {
      expect(() => menuLanguages(supported, uiLang), uiLang).not.toThrow();
      expect(menuLanguages(supported, uiLang)).toEqual(menuLanguages(supported, "en"));
    }
  });

  it("fits within two 25-option select menus", () => {
    expect(menuLanguages(supported).length).toBeLessThanOrEqual(50);
  });

  it("names and sorts the languages in the requested language", () => {
    const menu = menuLanguages(supported, "fr");
    const labels = menu.map((m) => m.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "fr")));
    expect(menu).toContainEqual({ code: "de", label: "Allemand" });
    expect(menu).toContainEqual({ code: "zh-Hant", label: "Chinois (traditionnel)" });
    expect(labels[0]).not.toBe(menuLanguages(supported).map((m) => m.label)[0]);
  });
});

describe("displayLanguageForLocale", () => {
  it.each([
    ["en-US", "en"],
    ["en-GB", "en"],
    ["", "en"],
    ["fr", "fr"],
    ["pt-BR", "pt-BR"],
    ["it", "it"],
  ])("names languages for %j in %s", (locale, uiLang) => {
    expect(displayLanguageForLocale(locale)).toBe(uiLang);
  });

  it("keeps the curated English labels rather than ICU's", () => {
    expect(labelFor("nb", displayLanguageForLocale("en-GB"))).toBe("Norwegian");
  });
});

describe("icuLanguageFor", () => {
  it.each([
    ["zt", "zh-Hant"],
    ["zh-Hant", "zh-Hant"],
    ["pb", "pt-BR"],
    ["no", "nb"],
    ["fr", "fr"],
  ])("turns the backend code %s into the tag %s", (code, tag) => {
    expect(icuLanguageFor(code)).toBe(tag);
  });

  it("gives every code in the table a tag Intl accepts", () => {
    // icuLanguageFor leans on codes[0] always being a valid BCP-47 tag, which is
    // a comment in the table and otherwise nothing's job to keep true.
    for (const def of LANGUAGES) {
      for (const code of def.codes) {
        expect(() => Intl.getCanonicalLocales(icuLanguageFor(code)), code).not.toThrow();
      }
    }
  });

  it("passes a code the table does not know straight through", () => {
    expect(icuLanguageFor("ar")).toBe("ar");
  });

  it("yields a tag ICU accepts for every code in the table", () => {
    for (const def of LANGUAGES) {
      for (const code of def.codes) {
        expect(labelFor("fr", icuLanguageFor(code)), code).not.toBe("");
      }
    }
  });
});

describe("labelFor", () => {
  it("finds a label by any of its codes", () => {
    expect(labelFor("zt")).toBe("Chinese (Traditional)");
    expect(labelFor("zh-Hant")).toBe("Chinese (Traditional)");
    expect(labelFor("pt-BR")).toBe("Portuguese (Brazil)");
    expect(labelFor("no")).toBe("Norwegian");
  });

  it("returns the code itself when unknown", () => {
    expect(labelFor("ar")).toBe("ar");
  });

  it.each([
    ["de", "fr", "Allemand"],
    ["zt", "de", "Chinesisch (Traditionell)"],
    ["pb", "ja", "ポルトガル語 (ブラジル)"],
    ["nb", "en", "Norwegian"],
  ])("names %s in %s as %s", (code, uiLang, label) => {
    expect(labelFor(code, uiLang)).toBe(label);
  });

  it("never throws for a value ICU cannot name", () => {
    expect(labelFor("auto", "fr")).toBe("auto");
    expect(labelFor("t_0123456789abcdef", "de")).toBe("t_0123456789abcdef");
    expect(labelFor("de", "not a locale")).toBe("German");
  });
});

describe("parseLanguageHint", () => {
  it.each([
    ["fr", "fr"],
    ["French", "fr"],
    ["to french", "fr"],
    ["into  Spanish", "es"],
    ["in Japanese", "ja"],
    ["zh-TW", "zh-Hant"],
    ["zh-hant", "zh-Hant"],
    ["chinese", "zh-Hans"],
    ["Chinese (Traditional)", "zh-Hant"],
    ["pt-br", "pt-BR"],
    ["portuguese", "pt"],
    ["ar", "ar"],
  ])("reads %j as %s", (text, code) => {
    expect(parseLanguageHint(text, supported)).toBe(code);
  });

  it("returns null for empty text or text that names no language", () => {
    expect(parseLanguageHint("", supported)).toBeNull();
    expect(parseLanguageHint("   ", supported)).toBeNull();
    expect(parseLanguageHint("please translate this", supported)).toBeNull();
  });

  it("returns null when the named language is unsupported", () => {
    expect(parseLanguageHint("croatian", supported)).toBeNull();
  });

  it.each([
    ["allemand", "fr", "de"],
    ["to Allemand", "fr", "de"],
    ["chinois", "fr", "zh-Hans"],
    ["chinois (traditionnel)", "fr", "zh-Hant"],
    ["german", "fr", "de"],
    ["日本語", "ja", "ja"],
  ])("reads %j in %s as %s", (text, uiLang, code) => {
    expect(parseLanguageHint(text, supported, uiLang)).toBe(code);
  });
});

describe("parseLanguageSpec", () => {
  it.each([
    ["fr:en", "fr", "en"],
    ["french:english", "fr", "en"],
    ["fr:", "fr", null],
    [":de", null, "de"],
    [" fr : en ", "fr", "en"],
    ["de", null, "de"],
    ["to german", null, "de"],
    ["", null, null],
  ])("reads %j as source %s → target %s", (text, source, target) => {
    expect(parseLanguageSpec(text, supported)).toEqual({ source, target, unresolved: [] });
  });

  it("accepts localized names on either side", () => {
    expect(parseLanguageSpec("allemand:anglais", supported, "fr")).toEqual({ source: "de", target: "en", unresolved: [] });
  });

  it("reports the parts it cannot resolve", () => {
    expect(parseLanguageSpec("klingon:en", supported)).toEqual({ source: null, target: "en", unresolved: ["klingon"] });
    expect(parseLanguageSpec("fr:klingon", supported)).toEqual({ source: "fr", target: null, unresolved: ["klingon"] });
    expect(parseLanguageSpec("please", supported)).toEqual({ source: null, target: null, unresolved: ["please"] });
  });
});
