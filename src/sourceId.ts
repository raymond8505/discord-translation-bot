import { createHash } from "node:crypto";

const SNOWFLAKE = /^\d{17,20}$/;
const TEXT_PREFIX = "t_";
/** Enough for a display id, and the customId it rides in caps at 100 chars. */
const SOURCE_ID_CHARS = 16;
/**
 * 128 bits. A `tr:` key is never in a customId, so it is not squeezed the way a
 * source id is — and a collision there serves one person's translation to
 * another for a whole TTL, which is worth the extra characters.
 */
const CONTENT_HASH_CHARS = 32;

function digest(text: string): string {
  return createHash("sha256").update(text.normalize("NFC")).digest("hex");
}

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
  return `${TEXT_PREFIX}${digest(text).slice(0, SOURCE_ID_CHARS)}`;
}

/**
 * Identity of the *text* of a translation, for the `tr:` key. A source id says
 * where something was said; this says what was said, which is what decides
 * whether the backend has already translated it.
 */
export function contentHash(text: string): string {
  return digest(text).slice(0, CONTENT_HASH_CHARS);
}

/** True when the id is a message snowflake and the message can be re-fetched. */
export function isMessageSourceId(sourceId: string): boolean {
  return SNOWFLAKE.test(sourceId);
}
