import { describe, expect, it } from "vitest";
import { placeholdersOf, protect, restore } from "./segments.js";

describe("protect / restore", () => {
  it("round-trips placeholders and code spans through numbered tokens", () => {
    const source = 'I don\'t know a language called "{name}". Try `fr:en` or `/translate`.';
    const shielded = protect(source);

    expect(shielded.text).toBe('I don\'t know a language called "XZ0XZ". Try XZ1XZ or XZ2XZ.');
    expect(shielded.slots).toEqual(["{name}", "`fr:en`", "`/translate`"]);
    expect(restore(shielded.text, shielded.slots)).toBe(source);
  });

  it("restores tokens in any order and tolerates re-casing or padding", () => {
    const { slots } = protect("{language} ({percent}%)");
    expect(restore("(xz 1 xz%) XZ0XZ", slots)).toBe("({percent}%) {language}");
  });

  it("returns null when a token was dropped", () => {
    const { text, slots } = protect("Translation → {label}");
    expect(restore(text.replace("XZ0XZ", ""), slots)).toBeNull();
  });

  it("returns null when a token was duplicated or invented", () => {
    const { slots } = protect("{name}");
    expect(restore("XZ0XZ XZ0XZ", slots)).toBeNull();
    expect(restore("XZ0XZ XZ7XZ", slots)).toBeNull();
  });

  it("leaves text without protected segments untouched", () => {
    const shielded = protect("Nothing to translate.");
    expect(shielded).toEqual({ text: "Nothing to translate.", slots: [] });
    expect(restore("Rien à traduire.", [])).toBe("Rien à traduire.");
  });
});

describe("placeholdersOf", () => {
  it("lists each placeholder name once, code spans included", () => {
    expect(placeholdersOf("detected: {language} ({percent}%) `{notme}`")).toEqual(
      new Set(["language", "percent", "notme"]),
    );
    expect(placeholdersOf("plain")).toEqual(new Set());
  });
});
