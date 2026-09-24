import { describe, expect, it } from "vitest";
import { exampleSharedFlags, flagsForLanguage, flagForRegion, isFlagEmoji, languageForFlag, regionForFlag } from "./flags.js";
import { libreLanguageCodes, makeSupported, primaryOnlyCodes } from "./fixtures/languages.fixture.js";
import { FLAGS, NON_FLAGS } from "./fixtures/reaction.fixture.js";

const supported = makeSupported();

describe("regionForFlag", () => {
  it("reads the region from an indicator pair and from a subdivision tag sequence", () => {
    expect(regionForFlag(FLAGS.france)).toBe("FR");
    expect(regionForFlag(FLAGS.england)).toBe("GBENG");
    expect(regionForFlag(FLAGS.scotland)).toBe("GBSCT");
  });

  it("refuses everything that is not a region flag", () => {
    for (const emoji of Object.values(NON_FLAGS)) {
      expect(regionForFlag(emoji)).toBeNull();
      expect(isFlagEmoji(emoji)).toBe(false);
    }
  });

  it("calls a flag a flag even when no language comes of it", () => {
    expect(isFlagEmoji(FLAGS.cambodia)).toBe(true);
    expect(languageForFlag(FLAGS.cambodia, supported)).toBeNull();
  });
});

describe("exampleSharedFlags", () => {
  it("builds flags back out of their regions, all naming the same language", () => {
    expect(flagForRegion("FR")).toBe(FLAGS.france);

    const example = exampleSharedFlags().split(" ");
    expect(example).toEqual([FLAGS.uk, FLAGS.usa, FLAGS.canada, FLAGS.australia]);
    expect(example.map((flag) => languageForFlag(flag, supported))).toEqual(example.map(() => "en"));
  });
});

describe("languageForFlag", () => {
  it("collapses every English-speaking flag onto en", () => {
    const english = [FLAGS.uk, FLAGS.usa, FLAGS.canada, FLAGS.australia, FLAGS.england, FLAGS.scotland];
    expect(english.map((flag) => languageForFlag(flag, supported))).toEqual(english.map(() => "en"));
  });

  it("keeps the regional codes the backend itself distinguishes", () => {
    expect(languageForFlag(FLAGS.brazil, supported)).toBe("pt-BR");
    expect(languageForFlag(FLAGS.taiwan, supported)).toBe("zh-Hant");
    expect(languageForFlag(FLAGS.china, supported)).toBe("zh-Hans");
  });

  it("falls back the way the menus do when the backend lacks the preferred code", () => {
    const primary = makeSupported(primaryOnlyCodes);
    expect(languageForFlag(FLAGS.brazil, primary)).toBe("pt");
    expect(languageForFlag(FLAGS.taiwan, primary)).toBe("zh");
  });

  it("has no language for an unmapped region, an unloaded language, or a non-flag", () => {
    // Croatian is in the table; this backend has no model for it.
    expect(languageForFlag(FLAGS.croatia, supported)).toBeNull();
    const withoutJapanese = makeSupported(libreLanguageCodes.filter((code) => code !== "ja"));
    expect(languageForFlag(FLAGS.japan, withoutJapanese)).toBeNull();
    expect(languageForFlag(FLAGS.japan, supported)).toBe("ja");
    expect(languageForFlag(NON_FLAGS.thumbsUp, supported)).toBeNull();
  });

  it("names every flag that asks for a language, in table order", () => {
    // Not just the first: someone deciding what to react with needs to know
    // their own country's flag works.
    expect(flagsForLanguage("en", supported).slice(0, 7)).toEqual([
      FLAGS.uk,
      FLAGS.usa,
      FLAGS.canada,
      FLAGS.australia,
      FLAGS.newZealand,
      FLAGS.ireland,
      FLAGS.southAfrica,
    ]);
    // The long tail matters just as much: reacting from Kingston or Dakar works.
    expect(flagsForLanguage("en", supported)).toContain(FLAGS.jamaica);
    expect(flagsForLanguage("fr", supported)).toContain(FLAGS.senegal);
    expect(flagsForLanguage("nl", supported)).toContain(FLAGS.suriname);
    expect(flagsForLanguage("ja", supported)).toEqual([FLAGS.japan]);
    expect(flagsForLanguage("pt-BR", supported)).toEqual([FLAGS.brazil]);
  });

  it("leaves out subdivision flags, which many clients cannot draw", () => {
    // They still resolve as reactions; they are just not worth recommending.
    expect(languageForFlag(FLAGS.england, supported)).toBe("en");
    expect(flagsForLanguage("en", supported)).not.toContain(FLAGS.england);
  });

  it("has no flag for a language the backend does not serve", () => {
    // Croatian is in the table but unloaded here, so nothing resolves to it.
    expect(flagsForLanguage("hr", supported)).toEqual([]);
    expect(flagsForLanguage("klingon", supported)).toEqual([]);
  });

});
