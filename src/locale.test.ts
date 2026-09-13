import { describe, expect, it } from "vitest";
import { makeSupported, primaryOnlyCodes } from "./fixtures/languages.fixture.js";
import {
  LANGUAGES,
  labelFor,
  menuLanguages,
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

  it("fits within two 25-option select menus", () => {
    expect(menuLanguages(supported).length).toBeLessThanOrEqual(50);
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

  it("reports the parts it cannot resolve", () => {
    expect(parseLanguageSpec("klingon:en", supported)).toEqual({ source: null, target: "en", unresolved: ["klingon"] });
    expect(parseLanguageSpec("fr:klingon", supported)).toEqual({ source: "fr", target: null, unresolved: ["klingon"] });
    expect(parseLanguageSpec("please", supported)).toEqual({ source: null, target: null, unresolved: ["please"] });
  });
});
