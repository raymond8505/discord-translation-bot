import { describe, expect, it } from "vitest";
import { parseSelectCustomId } from "./components/customId.js";
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
    source: "auto",
    entry: makeCacheEntry(),
    cached: false,
    sameLanguage: false,
    supported,
    ...overrides,
  });
}

/** Flattens the rows into [customId, options] pairs. */
function menus(reply: ReturnType<typeof build>) {
  return reply.components.map((row) => {
    const menu = row.toJSON().components[0];
    return { id: parseSelectCustomId(menu?.custom_id ?? ""), options: menu?.options ?? [], placeholder: menu?.placeholder };
  });
}

describe("buildTranslationReply", () => {
  it("renders the translation with target, detected source and backend", () => {
    const embed = build().embeds[0]?.toJSON();

    expect(embed?.title).toBe("Translation → English");
    expect(embed?.description).toBe(makeCacheEntry().text);
    expect(embed?.footer?.text).toBe("source: Spanish · libretranslate");
  });

  it("annotates cached and same-language results in the footer", () => {
    const embed = build({ cached: true, sameLanguage: true }).embeds[0]?.toJSON();

    expect(embed?.footer?.text).toContain("cached");
    expect(embed?.footer?.text).toContain("already in the target language");
  });

  it("shows the detection confidence and, when low, how to force the source", () => {
    const confident = build({ entry: makeCacheEntry({ confidence: 92.5 }) }).embeds[0]?.toJSON();
    expect(confident?.footer?.text).toContain("detected: Spanish (93%)");
    expect(confident?.fields).toBeUndefined();

    const unsure = build({ entry: makeCacheEntry({ confidence: 45 }) }).embeds[0]?.toJSON();
    expect(unsure?.footer?.text).toContain("detected: Spanish (45%)");
    expect(unsure?.fields?.[0]?.name).toMatch(/Not sure/);
    expect(unsure?.fields?.[0]?.value).toContain("fr:en");
  });

  it("labels a forced source as given rather than detected", () => {
    const embed = build({ entry: makeCacheEntry({ source_lang: "fr" }) }).embeds[0]?.toJSON();
    expect(embed?.footer?.text).toContain("source: French");
    expect(embed?.footer?.text).not.toContain("detected");
  });

  it("truncates long text to the embed limit", () => {
    const embed = build({ entry: makeCacheEntry({ text: "y".repeat(5000) }) }).embeds[0]?.toJSON();

    expect(embed?.description).toHaveLength(4096);
    expect(embed?.description?.endsWith("…")).toBe(true);
  });

  it("offers source menus then target menus, each split across at most two 25-option rows", () => {
    const all = menus(build());
    const expected = menuLanguages(supported).map((l) => l.code);

    expect(all.length).toBeLessThanOrEqual(4);
    for (const menu of all) expect(menu.options.length).toBeLessThanOrEqual(25);

    const source = all.filter((m) => m.id?.role === "source");
    const target = all.filter((m) => m.id?.role === "target");
    expect(all.map((m) => m.id?.role)).toEqual([...source, ...target].map((m) => m.id?.role));
    expect(source.flatMap((m) => m.options.map((o) => o.value))).toEqual(["auto", ...expected]);
    expect(target.flatMap((m) => m.options.map((o) => o.value))).toEqual(expected);
    expect(source.map((m) => m.id?.menuIndex)).toEqual(source.map((_, i) => i));
    expect(target.map((m) => m.id?.menuIndex)).toEqual(target.map((_, i) => i));
    expect(source[0]?.placeholder).toMatch(/^Translate from…/);
    expect(target[0]?.placeholder).toMatch(/^Translate to…/);
  });

  it("carries the counterpart's current value in each menu's customId", () => {
    const all = menus(build({ target: "de", source: "fr" }));

    for (const menu of all.filter((m) => m.id?.role === "source")) expect(menu.id?.other).toBe("de");
    for (const menu of all.filter((m) => m.id?.role === "target")) expect(menu.id?.other).toBe("fr");
    for (const menu of all) expect(menu.id?.sourceId).toBe(ID);
  });

  it("preselects the detected source and the current target", () => {
    const all = menus(build({ target: "fr", entry: makeCacheEntry({ source_lang: "es" }) }));

    const sourceDefaults = all.filter((m) => m.id?.role === "source").flatMap((m) => m.options.filter((o) => o.default));
    const targetDefaults = all.filter((m) => m.id?.role === "target").flatMap((m) => m.options.filter((o) => o.default));
    expect(sourceDefaults.map((o) => o.value)).toEqual(["es"]);
    expect(targetDefaults.map((o) => o.value)).toEqual(["fr"]);
  });

  it("omits every menu when the backend has reported no languages yet", () => {
    // A lone "Auto-detect" option would be no choice at all.
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
