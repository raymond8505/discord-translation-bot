import { describe, expect, it } from "vitest";
import { sendDirect } from "./dm.js";
import { makeRecipient } from "./fixtures/dm.fixture.js";
import { makeRecordingLogger } from "./fixtures/context.fixture.js";
import { buildNoticeReply } from "./reply.js";

const NOTICE = buildNoticeReply("nope");

describe("sendDirect", () => {
  it("delivers the payload and reports that it arrived", async () => {
    const log = makeRecordingLogger();
    const recipient = makeRecipient({ id: "42" });

    await expect(sendDirect(log, recipient, NOTICE, "flag reaction")).resolves.toBe(true);

    expect(recipient.dms).toEqual([NOTICE]);
    expect(log.entries).toEqual([]);
  });

  it("reports a closed DM without throwing, and never falls back to the channel", async () => {
    const log = makeRecordingLogger();
    const recipient = makeRecipient({ id: "42", closed: true });

    await expect(sendDirect(log, recipient, NOTICE, "flag reaction")).resolves.toBe(false);

    // A refusal the user won't accept is dropped: the whole point is that it
    // stays between the bot and the person who asked.
    expect(log.entries.map((entry) => entry.level)).toEqual(["warn"]);
    expect(log.entries[0]?.message).toContain("flag reaction");
  });
});
