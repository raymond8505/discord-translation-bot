import { afterEach, describe, expect, it, vi } from "vitest";
import { makeRecordingLogger } from "./fixtures/context.fixture.js";
import { makeTypingChannel } from "./fixtures/post.fixture.js";
import { showThinking } from "./typing.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("showThinking", () => {
  it("types at once, so the wait is filled from its first moment", () => {
    const channel = makeTypingChannel();

    showThinking(makeRecordingLogger(), channel).stop();

    expect(channel.typingCount).toBe(1);
  });

  it("refreshes inside Discord's ten-second window until it is stopped", async () => {
    vi.useFakeTimers();
    const channel = makeTypingChannel();
    const thinking = showThinking(makeRecordingLogger(), channel);

    await vi.advanceTimersByTimeAsync(9_000);
    expect(channel.typingCount).toBe(2);

    thinking.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.typingCount).toBe(2);
  });

  it("gives up on its own once the backend could no longer answer", async () => {
    vi.useFakeTimers();
    const channel = makeTypingChannel();

    showThinking(makeRecordingLogger(), channel);

    await vi.advanceTimersByTimeAsync(30_000);
    const covered = channel.typingCount;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(channel.typingCount).toBe(covered);
  });

  it("warns once and stops refreshing when the channel refuses", async () => {
    vi.useFakeTimers();
    const log = makeRecordingLogger();
    const channel = makeTypingChannel({ failing: true });

    showThinking(log, channel);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(channel.typingCount).toBe(1);
    expect(log.entries.filter((e) => e.level === "warn")).toHaveLength(1);
  });

  it("stays silent, and stoppable, where there is nothing to type in", () => {
    const log = makeRecordingLogger();

    expect(() => showThinking(log, null).stop()).not.toThrow();
    expect(() => showThinking(log, makeTypingChannel({ withoutTyping: true })).stop()).not.toThrow();
    expect(log.entries).toHaveLength(0);
  });
});
