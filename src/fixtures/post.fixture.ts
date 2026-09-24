import type { PostRef } from "../posts.js";
import type { PostedMessage } from "../publish.js";
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
