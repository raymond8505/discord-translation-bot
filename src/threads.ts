import { MessageFlags } from "discord.js";

/** The slice of a channel that decides how loudly a post there should land. */
export interface PostChannel {
  isThread(): boolean;
}

/** Extra `send`/`reply` options a post carries on top of its payload. */
export interface PostOptions {
  readonly flags?: MessageFlags.SuppressNotifications;
}

/**
 * Posts made inside a thread are silent.
 *
 * A thread has followers rather than readers: everyone who has joined or spoken
 * in it is notified of every message, and a busy thread can produce a
 * translation per message. The translation still has to be public — it is for
 * whoever could not read the original — but it is an echo of something those
 * people have already been notified about once, so notifying them again for it
 * is pure noise. `SuppressNotifications` is exactly that distinction: the
 * message appears in the channel and in history for everyone, and fires no
 * push notification or unread ping.
 *
 * Outside a thread the post stays ordinary. A channel's members are not
 * subscribed the way a thread's are, so the same message is not a per-follower
 * alert, and silencing it there would only hide translations from the people
 * who asked for them.
 *
 * A channel the bot cannot see (uncached, or absent on a partial) is treated as
 * not a thread: that is how these posts have always behaved, and guessing
 * otherwise would silence a post nobody asked to be quiet.
 */
export function postOptionsFor(channel: PostChannel | null | undefined): PostOptions {
  return channel?.isThread() === true ? { flags: MessageFlags.SuppressNotifications } : {};
}
