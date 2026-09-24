import type { AppContext } from "./context.js";
import type { PostRef } from "./posts.js";
import { buildTranslationReply } from "./reply.js";
import { AUTO_SOURCE, translateWithCache } from "./translate.js";

/** The slice of `Message` / `PartialMessage` the invalidator reads. */
export interface InvalidationMessage {
  readonly id: string;
  readonly partial: boolean;
  readonly content: string | null;
  readonly guildId: string | null;
  readonly guild: { readonly preferredLocale: string } | null;
  fetch(): Promise<InvalidationMessage>;
}

/**
 * An edit whose text is unchanged (embed unfurls, pin changes) keeps its
 * translations. A partial old message has no content to compare, so it is
 * treated as changed.
 */
export function shouldInvalidateOnUpdate(
  oldMessage: InvalidationMessage,
  newMessage: InvalidationMessage,
): boolean {
  if (oldMessage.partial) return true;
  return oldMessage.content !== newMessage.content;
}

export interface MessageInvalidator {
  onUpdate(oldMessage: InvalidationMessage, newMessage: InvalidationMessage): Promise<void>;
  onDelete(message: InvalidationMessage): Promise<void>;
}

type InvalidationContext = Pick<
  AppContext,
  "backend" | "cache" | "i18n" | "languages" | "log" | "messages" | "posts" | "rateLimiter"
>;

/**
 * Keeps what the bot has said about a message true after the message changes.
 *
 * An edit drops the cache entries (a stale translation must never be served
 * again) and then rewrites the translations already sitting in the channel —
 * those are the copies a reader actually sees, and a translation presented as a
 * reading of a message that now says something else is worse than none.
 *
 * Cache failures here are logged only; a stale entry expires on its TTL anyway.
 */
export function createMessageInvalidator(ctx: InvalidationContext): MessageInvalidator {
  const invalidate = async (id: string, reason: string): Promise<void> => {
    try {
      const deleted = await ctx.cache.invalidate(id);
      if (deleted > 0) ctx.log.info(`invalidated ${deleted} cache keys for message ${id} (${reason})`);
    } catch (err) {
      ctx.log.warn(`cache invalidation failed for message ${id}`, err);
    }
  };

  /**
   * Whether the stored source text already matches what the message now says.
   * A partial `oldMessage` has no content to compare, so every unfurl and pin
   * on pre-boot history arrives here looking like an edit; without this guard
   * each one costs a backend call and a rewrite per post.
   */
  const textIsUnchanged = async (id: string, content: string): Promise<boolean> => {
    try {
      return (await ctx.cache.getSource(id)) === content;
    } catch (err) {
      ctx.log.warn(`cache getSource failed for message ${id}; assuming it changed`, err);
      return false;
    }
  };

  const refresh = async (message: InvalidationMessage, refs: readonly PostRef[]): Promise<void> => {
    const tr = ctx.i18n.forLocale(message.guild?.preferredLocale ?? "");
    const supported = await ctx.languages.get();
    const text = message.content ?? "";

    // Every ref re-translates the same new text, so two refs sharing a target
    // collide in the content-keyed cache — and a forced ref's auto-mirror feeds
    // an auto ref its correction. That is the correction winning, as intended.
    for (const ref of refs) {
      // No user asked for this, so only the guild's hourly budget sees it. A
      // refusal stops the whole refresh: every remaining post faces the same
      // exhausted budget, and an edit must never answer with anything but an edit.
      const limit = await ctx.rateLimiter.check({ userId: null, guildId: message.guildId });
      if (!limit.allowed) {
        ctx.log.warn(`edit refresh: rate limited (${limit.scope ?? "unknown"} budget); leaving posts stale`);
        return;
      }

      try {
        const source = ref.source === AUTO_SOURCE ? undefined : ref.source;
        const outcome = await translateWithCache(ctx, {
          sourceId: message.id,
          text,
          target: ref.target,
          source,
        });
        const reply = buildTranslationReply({
          ...outcome,
          sourceId: message.id,
          source: ref.source,
          supported,
          tr,
        });
        if ((await ctx.messages.edit(ref, reply)) === "gone") {
          ctx.log.info(`edit refresh: post ${ref.messageId} is gone; forgetting it`);
          await ctx.posts.forget(message.id, ref.messageId);
        }
      } catch (err) {
        // One target failing must not cost the others theirs.
        ctx.log.warn(`edit refresh: could not update post ${ref.messageId} (${ref.target})`, err);
      }
    }
  };

  return {
    async onUpdate(oldMessage, newMessage) {
      if (!shouldInvalidateOnUpdate(oldMessage, newMessage)) return;

      // A partial carries no content, and the new text is the whole point here.
      let message = newMessage;
      if (message.partial) {
        try {
          message = await message.fetch();
        } catch (err) {
          ctx.log.warn(`could not fetch edited message ${newMessage.id}`, err);
          return;
        }
      }

      if (await textIsUnchanged(message.id, message.content ?? "")) return;
      await invalidate(message.id, "edited");

      let refs: PostRef[];
      try {
        refs = await ctx.posts.list(message.id);
      } catch (err) {
        ctx.log.warn(`could not read the post registry for message ${message.id}`, err);
        return;
      }
      if (refs.length === 0) return;

      // Nothing to translate. The posts stay as they are: there is no text to
      // put in them, and deleting them erases what the channel was told.
      if (!(message.content ?? "").trim()) {
        ctx.log.info(`edit refresh: message ${message.id} has no text left; leaving ${refs.length} posts`);
        return;
      }

      await refresh(message, refs);
    },

    async onDelete(message) {
      await invalidate(message.id, "deleted");
      try {
        await ctx.posts.drop(message.id);
      } catch (err) {
        ctx.log.warn(`could not drop the post registry for message ${message.id}`, err);
      }
    },
  };
}
