import { describe, expect, it } from "vitest";
import { buildSelectCustomId } from "./components/customId.js";
import { makeCacheEntry } from "./fixtures/cache.fixture.js";
import { makeSupported } from "./fixtures/languages.fixture.js";
import { menuLanguages } from "./locale.js";
import { buildNoticeReply, buildTranslationReply } from "./reply.js";

const ID = "123456789012345678";
const supported = makeSupported();

function build(overrides: Partial<Parameters<typeof buildTranslationReply>[0]> = {}) {
  return buildTranslationReply({
    sourceId: ID,
    target: "en",
    entry: makeCacheEntry(),
    cached: false,
    sameLanguage: false,
    supported,
    ...overrides,
  });
}

describe("buildTranslationReply", () => {
  it("renders the translation with target, detected source and backend", () => {
    const embed = build().embeds[0]?.toJSON();

    expect(embed?.title).toBe("Translation → English");
    expect(embed?.description).toBe(makeCacheEntry().text);
    expect(embed?.footer?.text).toBe("detected: Spanish · libretranslate");
  });

  it("annotates cached and same-language results in the footer", () => {
    const embed = build({ cached: true, sameLanguage: true }).embeds[0]?.toJSON();

    expect(embed?.footer?.text).toContain("cached");
    expect(embed?.footer?.text).toContain("already in the target language");
  });

  it("truncates long text to the embed limit", () => {
    const embed = build({ entry: makeCacheEntry({ text: "y".repeat(5000) }) }).embeds[0]?.toJSON();

    expect(embed?.description).toHaveLength(4096);
    expect(embed?.description?.endsWith("…")).toBe(true);
  });

  it("splits the supported languages across at most two 25-option menus", () => {
    const rows = build().components.map((row) => row.toJSON());
    const expected = menuLanguages(supported);

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(2);
    const menus = rows.map((row) => row.components[0]);
    for (const menu of menus) expect(menu?.options.length).toBeLessThanOrEqual(25);
    expect(menus.flatMap((menu) => menu?.options.map((o) => o.value))).toEqual(expected.map((l) => l.code));
    expect(menus.map((menu) => menu?.custom_id)).toEqual(menus.map((_, i) => buildSelectCustomId(i, ID)));
  });

  it("marks the current target as the default option", () => {
    const options = build({ target: "fr" })
      .components.flatMap((row) => row.toJSON().components[0]?.options ?? []);

    expect(options.filter((o) => o.default).map((o) => o.value)).toEqual(["fr"]);
  });

  it("omits the menus when the backend has reported no languages yet", () => {
    expect(build({ supported: new Set() }).components).toEqual([]);
  });
});

describe("buildNoticeReply", () => {
  it("is a bare embed with no components", () => {
    const reply = buildNoticeReply("Nothing to translate.");
    expect(reply.embeds[0]?.toJSON().description).toBe("Nothing to translate.");
    expect(reply.components).toEqual([]);
  });
});
