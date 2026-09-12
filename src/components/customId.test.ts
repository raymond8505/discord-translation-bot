import { describe, expect, it } from "vitest";
import { buildSelectCustomId, isSelectCustomId, parseSelectCustomId } from "./customId.js";

describe("select customId", () => {
  it("round-trips a message id and a text hash id", () => {
    for (const sourceId of ["123456789012345678", "t_0123456789abcdef"]) {
      const id = buildSelectCustomId(1, sourceId);
      expect(id.length).toBeLessThanOrEqual(100);
      expect(isSelectCustomId(id)).toBe(true);
      expect(parseSelectCustomId(id)).toEqual({ menuIndex: 1, sourceId });
    }
  });

  it("rejects ids it did not build", () => {
    expect(parseSelectCustomId("lang:x:123")).toBeNull();
    expect(parseSelectCustomId("other:0:123")).toBeNull();
    expect(parseSelectCustomId("lang:0:has space")).toBeNull();
    expect(isSelectCustomId("other:0:123")).toBe(false);
  });
});
