import { MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import { postOptionsFor } from "./threads.js";

describe("postOptionsFor", () => {
  it("silences a post made in a thread", () => {
    expect(postOptionsFor({ isThread: () => true })).toEqual({
      flags: MessageFlags.SuppressNotifications,
    });
  });

  it("leaves an ordinary channel post alone", () => {
    // Spreading `{}` adds no key, so the payload is byte-for-byte what it was.
    expect(postOptionsFor({ isThread: () => false })).toEqual({});
  });

  it("treats a channel it cannot see as not a thread", () => {
    // Uncached, or absent on a partial. Guessing the other way would silence a
    // post nobody asked to be quiet.
    expect(postOptionsFor(null)).toEqual({});
    expect(postOptionsFor(undefined)).toEqual({});
  });
});
