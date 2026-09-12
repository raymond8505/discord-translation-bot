import { describe, expect, it } from "vitest";
import { BackendError, type BackendErrorKind } from "./backends/index.js";
import { isOperational, userMessageFor } from "./errors.js";

describe("userMessageFor", () => {
  it.each<[BackendErrorKind, RegExp]>([
    ["network", /starting up|unavailable/],
    ["http", /starting up|unavailable/],
    ["timeout", /too long/],
    ["unavailable", /not available/],
    ["invalid_response", /couldn't read/],
  ])("words a %s backend error for the user", (kind, expected) => {
    expect(userMessageFor(new BackendError(kind, "x"))).toMatch(expected);
  });

  it("gives a generic message for anything else", () => {
    expect(userMessageFor(new Error("boom"))).toMatch(/Something went wrong/);
    expect(userMessageFor("string")).toMatch(/Something went wrong/);
  });
});

describe("isOperational", () => {
  it("is true only for backend errors", () => {
    expect(isOperational(new BackendError("timeout", "x"))).toBe(true);
    expect(isOperational(new TypeError("x"))).toBe(false);
  });
});
