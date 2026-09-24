import type { AppContext } from "./context.js";
import { isMessageSourceId } from "./sourceId.js";

/** The slice of a sent `Message` the registry keeps. */
export interface PostedMessage {
  readonly id: string;
  readonly channelId: string;
}

export interface PublishInput {
  readonly sourceId: string;
  readonly target: string;
  /** The source that produced this translation: a forced code, or `auto`. */
  readonly source: string;
  /** Sends the translation, however the surface sends things. */
  post(): Promise<PostedMessage>;
}

type PublishContext = Pick<AppContext, "posts" | "log">;

/**
 * Posts a translation and remembers where it landed, so an edit to the source
 * message can find it again. Every surface goes through here rather than
 * calling `reply()`/`send()` itself: a post nobody recorded is a translation
 * that silently stops following its message.
 *
 * A registry failure is logged and swallowed — the post has already landed, and
 * Redis trouble must cost edit-follow, never the reply itself.
 */
export async function publishTranslation(ctx: PublishContext, input: PublishInput): Promise<void> {
  const posted = await input.post();

  // `/translate text:` hashes its input into a `t_…` id; free text has no
  // message to be edited, so there is nothing to follow.
  if (!isMessageSourceId(input.sourceId)) return;

  try {
    await ctx.posts.record(input.sourceId, {
      channelId: posted.channelId,
      messageId: posted.id,
      target: input.target,
      source: input.source,
    });
  } catch (err) {
    ctx.log.warn(`could not record the translation posted for message ${input.sourceId}`, err);
  }
}
