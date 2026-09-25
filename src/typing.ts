import type { Logger } from "./log.js";
import type { PostChannel } from "./threads.js";

/**
 * Discord's typing indicator "expires after 10 seconds"
 * (https://discord.com/developers/docs/resources/channel#trigger-typing-indicator),
 * so it is refreshed inside that window with room for the round trip.
 */
const REFRESH_MS = 8_000;

/**
 * The backend's own translate timeout (`LibreTranslateBackend`), past which
 * there is no answer left to wait for. A promise that never settles must not
 * leave the bot typing at an empty channel forever.
 */
const MAX_MS = 30_000;

/** Refreshes after the first call, enough to cover `MAX_MS` of waiting. */
const REFRESHES = Math.floor(MAX_MS / REFRESH_MS);

export interface ThinkingSignal {
  /** Idempotent: the indicator clears on its own once the post lands. */
  stop(): void;
}

const INERT: ThinkingSignal = { stop: () => {} };

/**
 * Shows the channel that the bot is working on a translation, the same way a
 * person composing a message shows.
 *
 * Every trigger needs this and each needs it for a different reason. The mention
 * and flag-reaction triggers have no interaction token, so between the ask and
 * the public post they say nothing at all; an interaction does defer, but that
 * "thinking" state is ephemeral and the channel — which is where the
 * translation is going to land — sees nothing either way.
 *
 * Typing is fire-and-forget in both directions. It is never awaited, because
 * the point is to fill the wait rather than lengthen it, and a failure is
 * swallowed: the bot may lack Send Messages in the channel, and a courtesy must
 * not cost a translation the backend can still deliver.
 *
 * A channel with no `sendTyping` (a partial group DM) or none at all (uncached)
 * yields an inert signal, so callers need no branch of their own.
 */
export function showThinking(log: Logger, channel: PostChannel | null | undefined): ThinkingSignal {
  const sendTyping = channel?.sendTyping?.bind(channel);
  if (!sendTyping) return INERT;

  let timer: ReturnType<typeof setInterval> | undefined;
  let left = REFRESHES;

  const stop = (): void => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };

  const fire = (): void => {
    void sendTyping().catch((err: unknown) => {
      // One line and then silence. Whatever denies the first call denies every
      // later one, so a channel the bot cannot type in costs one warning per
      // translation rather than one every eight seconds.
      log.warn("typing indicator failed; not shown for this translation", err);
      stop();
    });
  };

  fire();
  timer = setInterval(() => {
    if (left-- <= 0) {
      stop();
      return;
    }
    fire();
  }, REFRESH_MS);
  timer.unref();

  return { stop };
}
