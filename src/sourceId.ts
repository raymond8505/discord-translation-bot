import { createHash } from "node:crypto";

const SNOWFLAKE = /^\d{17,20}$/;
const TEXT_PREFIX = "t_";

/** Cache identity for a Discord message: its snowflake, unchanged. */
export function sourceIdForMessage(messageId: string): string {
  return messageId;
}

/**
 * Cache identity for free text (`/translate text:`): a content hash, so the
 * same text pasted twice shares one cache entry and the id stays well under
 * the 100-char customId limit.
 */
export function sourceIdForText(text: string): string {
  const digest = createHash("sha256").update(text.normalize("NFC")).digest("hex");
  return `${TEXT_PREFIX}${digest.slice(0, 16)}`;
}

/** True when the id is a message snowflake and the message can be re-fetched. */
export function isMessageSourceId(sourceId: string): boolean {
  return SNOWFLAKE.test(sourceId);
}
