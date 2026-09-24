import type { Logger } from "./log.js";
import type { ReplyPayload } from "./reply.js";

/**
 * The slice of `User` a refusal is delivered through. Only interactions can
 * answer ephemerally, so the triggers that have no interaction token — the
 * flag reaction and the mention — say nothing in the channel and say it here
 * instead. A refusal concerns the one person who asked; the channel asked for
 * nothing and should not be told.
 */
export interface DirectRecipient {
  readonly id: string;
  send(payload: ReplyPayload): Promise<unknown>;
}

/**
 * Delivers a refusal privately. Returns whether it arrived.
 *
 * A closed DM is the ordinary case, not an error: server members routinely
 * disallow direct messages from a guild's bots, and Discord answers `50007`.
 * There is deliberately no fallback to a channel post — the whole point is
 * that a refusal stays between the bot and the person who asked, and falling
 * back would make privacy depend on a setting the bot cannot see beforehand.
 */
export async function sendDirect(
  log: Logger,
  recipient: DirectRecipient,
  payload: ReplyPayload,
  context: string,
): Promise<boolean> {
  try {
    await recipient.send(payload);
    return true;
  } catch (err) {
    log.warn(`${context}: could not DM user ${recipient.id}; staying silent`, err);
    return false;
  }
}
