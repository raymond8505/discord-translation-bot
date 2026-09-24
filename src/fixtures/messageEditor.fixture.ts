import type { EditOutcome, MessageEditor } from "../messages.js";
import type { PostRef } from "../posts.js";
import type { ReplyPayload } from "../reply.js";

export interface FakeMessageEditor extends MessageEditor {
  /** Every edit attempted, in order. */
  readonly edits: Array<{ ref: PostRef; payload: ReplyPayload }>;
}

export interface FakeMessageEditorOptions {
  /** Message ids to answer `gone` for, modelling a post deleted from the channel. */
  gone?: readonly string[];
  /** Message ids whose edit rejects, modelling a Discord failure that is not `gone`. */
  failing?: readonly string[];
}

export function makeFakeMessageEditor(options: FakeMessageEditorOptions = {}): FakeMessageEditor {
  const edits: FakeMessageEditor["edits"] = [];
  const gone = new Set(options.gone ?? []);
  const failing = new Set(options.failing ?? []);
  return {
    edits,
    async edit(ref, payload): Promise<EditOutcome> {
      edits.push({ ref, payload });
      if (failing.has(ref.messageId)) throw new Error("Missing Permissions");
      return gone.has(ref.messageId) ? "gone" : "ok";
    },
  };
}
