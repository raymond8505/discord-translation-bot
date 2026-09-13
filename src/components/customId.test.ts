import { describe, expect, it } from "vitest";
import { buildSelectCustomId, isSelectCustomId, parseSelectCustomId, type SelectCustomId } from "./customId.js";

describe("select customId", () => {
  it.each<SelectCustomId>([
    { role: "target", menuIndex: 1, other: "auto", sourceId: "123456789012345678" },
    { role: "source", menuIndex: 0, other: "en", sourceId: "t_0123456789abcdef" },
    { role: "target", menuIndex: 0, other: "zh-Hant", sourceId: "123456789012345678" },
    { role: "source", menuIndex: 1, other: "pt-BR", sourceId: "123456789012345678" },
  ])("round-trips %j", (id) => {
    const customId = buildSelectCustomId(id);
    expect(customId.length).toBeLessThanOrEqual(100);
    expect(isSelectCustomId(customId)).toBe(true);
    expect(parseSelectCustomId(customId)).toEqual(id);
  });

  it("rejects ids it did not build", () => {
    expect(parseSelectCustomId("lang:x:0:auto:123")).toBeNull();
    expect(parseSelectCustomId("lang:t:0:123")).toBeNull();
    expect(parseSelectCustomId("lang:t:0:f:123")).toBeNull();
    expect(parseSelectCustomId("lang:t:0:pt-BRASIL:123")).toBeNull();
    expect(parseSelectCustomId("other:t:0:auto:123")).toBeNull();
    expect(parseSelectCustomId("lang:t:0:auto:has space")).toBeNull();
    expect(isSelectCustomId("other:t:0:auto:123")).toBe(false);
  });
});
