import type { AppContext } from "./context.js";

/** The slice of `Message` / `PartialMessage` the invalidator reads. */
export interface InvalidationMessage {
  readonly id: string;
  readonly partial: boolean;
  readonly content: string | null;
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

/** Cache failures here are logged only; a stale entry expires on its TTL anyway. */
export function createMessageInvalidator(ctx: Pick<AppContext, "cache" | "log">): MessageInvalidator {
  const invalidate = async (id: string, reason: string): Promise<void> => {
    try {
      const deleted = await ctx.cache.invalidate(id);
      if (deleted > 0) ctx.log.info(`invalidated ${deleted} cache keys for message ${id} (${reason})`);
    } catch (err) {
      ctx.log.warn(`cache invalidation failed for message ${id}`, err);
    }
  };

  return {
    async onUpdate(oldMessage, newMessage) {
      if (!shouldInvalidateOnUpdate(oldMessage, newMessage)) return;
      await invalidate(newMessage.id, "edited");
    },
    async onDelete(message) {
      await invalidate(message.id, "deleted");
    },
  };
}
