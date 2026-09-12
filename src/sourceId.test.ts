import { describe, expect, it } from "vitest";
import { isMessageSourceId, sourceIdForMessage, sourceIdForText } from "./sourceId.js";

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
  });
});
