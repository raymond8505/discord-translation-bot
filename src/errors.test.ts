import { describe, expect, it } from "vitest";
import { BackendError, type BackendErrorKind } from "./backends/index.js";
import { errorKeyFor, isOperational, userMessageFor } from "./errors.js";
import { frenchMessages, makeMessages } from "./fixtures/messages.fixture.js";
import { createI18n, type MessageKey } from "./i18n/index.js";

const i18n = createI18n(makeMessages());
const english = i18n.forLocale("en-US");

describe("userMessageFor", () => {
  it.each<[BackendErrorKind, MessageKey, RegExp]>([
    ["network", "error.network", /starting up|unavailable/],
    ["http", "error.network", /starting up|unavailable/],
    ["timeout", "error.timeout", /too long/],
    ["unavailable", "error.unavailable", /not available/],
    ["invalid_response", "error.invalidResponse", /couldn't read/],
  ])("words a %s backend error for the user", (kind, key, expected) => {
    expect(errorKeyFor(new BackendError(kind, "x"))).toBe(key);
    expect(userMessageFor(new BackendError(kind, "x"), english)).toMatch(expected);
  });

  it("gives a generic message for anything else", () => {
    expect(userMessageFor(new Error("boom"), english)).toMatch(/Something went wrong/);
    expect(userMessageFor("string", english)).toMatch(/Something went wrong/);
  });

  it("speaks the reader's language", () => {
    expect(userMessageFor(new Error("boom"), i18n.forLocale("fr"))).toBe(frenchMessages["error.generic"]);
  });
});

describe("isOperational", () => {
  it("is true only for backend errors", () => {
    expect(isOperational(new BackendError("timeout", "x"))).toBe(true);
    expect(isOperational(new TypeError("x"))).toBe(false);
  });
});
