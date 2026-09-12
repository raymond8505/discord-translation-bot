import { describe, expect, it } from "vitest";
import { makeSupported, primaryOnlyCodes } from "./fixtures/languages.fixture.js";
import {
  LANGUAGES,
  labelFor,
  menuLanguages,
  parseLanguageHint,
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
    ["zh-CN", "zh"],
    ["sv-SE", "sv"],
    ["pt-BR", "pb"],
  ])("maps %s to %s", (locale, code) => {
    expect(resolveTarget(locale, supported)).toBe(code);
  });

  it("prefers the alternate code when the backend has it", () => {
    expect(resolveTarget("zh-TW", supported)).toBe("zt");
    expect(resolveTarget("no", supported)).toBe("nb");
  });

  it("falls back to the next candidate when the alternate is missing", () => {
    expect(resolveTarget("zh-TW", primaryOnly)).toBe("zh");
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
    expect(menu).toContainEqual({ code: "zt", label: "Chinese (Traditional)" });
  });

  it("drops an entry whose fallback collapses onto a listed code", () => {
    const menu = menuLanguages(primaryOnly);
    expect(menu.filter((m) => m.code === "zh")).toHaveLength(1);
    expect(menu.map((m) => m.label)).not.toContain("Chinese (Traditional)");
  });

  it("fits within two 25-option select menus", () => {
    expect(menuLanguages(supported).length).toBeLessThanOrEqual(50);
  });
});

describe("labelFor", () => {
  it("finds a label by any of its codes", () => {
    expect(labelFor("zt")).toBe("Chinese (Traditional)");
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
    ["zh-TW", "zt"],
    ["chinese", "zh"],
    ["Chinese (Traditional)", "zt"],
    ["pt-br", "pb"],
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
