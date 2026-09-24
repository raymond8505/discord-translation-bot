import { describe, expect, it } from "vitest";
import { contentHash, isMessageSourceId, sourceIdForMessage, sourceIdForText } from "./sourceId.js";

describe("sourceId", () => {
  it("uses the message snowflake unchanged", () => {
    expect(sourceIdForMessage("123456789012345678")).toBe("123456789012345678");
    expect(isMessageSourceId("123456789012345678")).toBe(true);
  });

  it("hashes free text to a short, stable, non-snowflake id", () => {
    const a = sourceIdForText("hola mundo");
    expect(a).toMatch(/^t_[0-9a-f]{16}$/);
    expect(sourceIdForText("hola mundo")).toBe(a);
    expect(sourceIdForText("hola mundo!")).not.toBe(a);
    expect(isMessageSourceId(a)).toBe(false);
  });

  it("treats canonically-equivalent Unicode as the same text", () => {
    expect(sourceIdForText("café")).toBe(sourceIdForText("café"));
    expect(contentHash("café")).toBe(contentHash("café"));
  });

  it("hashes content to a longer key than the customId-bound source id", () => {
    const a = contentHash("hola mundo");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(contentHash("hola mundo")).toBe(a);
    expect(contentHash("hola mundo!")).not.toBe(a);
    // Separate namespaces: a `tr:` key is never mistaken for a source id.
    expect(a).not.toBe(sourceIdForText("hola mundo"));
  });
});
