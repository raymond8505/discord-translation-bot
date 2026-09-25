import type { PostRef } from "../posts.js";
import type { PostedMessage } from "../publish.js";
import type { PostChannel } from "../threads.js";
import { AUTO_SOURCE } from "../translate.js";

export const CHANNEL_ID = "345678901234567890";
export const POSTED_MESSAGE_ID = "456789012345678901";

/**
 * Hands out a fresh message id per post, so a fixture driven twice records two
 * distinct posts and the registry keeps both.
 */
export function makePostedMessages(channelId = CHANNEL_ID): () => PostedMessage {
  let issued = 0n;
  return () => {
    const id = (BigInt(POSTED_MESSAGE_ID) + issued).toString();
    issued += 1n;
    return { id, channelId };
  };
}

export function makePostRef(overrides: Partial<PostRef> = {}): PostRef {
  return {
    channelId: CHANNEL_ID,
    messageId: POSTED_MESSAGE_ID,
    target: "fr",
    source: AUTO_SOURCE,
    ...overrides,
  };
}

export interface TypingChannelOptions {
  /** Models the one channel kind that cannot be typed in: `sendTyping` is absent. */
  withoutTyping?: boolean;
  /** `sendTyping` rejects, as it does where the bot lacks Send Messages. */
  failing?: boolean;
  inThread?: boolean;
}

export interface FakeTypingChannel extends PostChannel {
  /** Counts `sendTyping()` calls, so a test can watch the refresh. */
  typingCount: number;
}

/** A bare channel for `showThinking()`; the trigger fixtures carry their own. */
export function makeTypingChannel(options: TypingChannelOptions = {}): FakeTypingChannel {
  const channel: FakeTypingChannel = {
    typingCount: 0,
    isThread: () => options.inThread ?? false,
  };
  if (options.withoutTyping) return channel;
  channel.sendTyping = async () => {
    channel.typingCount += 1;
    if (options.failing) throw new Error("Missing Permissions");
  };
  return channel;
}
