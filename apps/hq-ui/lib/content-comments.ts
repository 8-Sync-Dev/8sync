// "Góp ý" (owner 2026-11-06): the owner's comments on a content item, saved as drafts in HQ's own DB
// (lib/server/content-comments.ts), then sent all at once to the item's posting room in one message.
// Pure: the sheet and the server share the limits and the message.
import { contentTaskText, type ContentItem } from "./content";

/** A comment's longest text, in characters (code points). */
export const COMMENT_MAX = 4000;
/** The longest message one send makes: N comments plus the item header. Past it, send fewer. */
export const COMMENTS_SEND_MAX = 12_000;
/** How many sent comments the "Đã gửi" history lists. */
export const COMMENTS_SENT_SHOWN = 20;

export type ContentComment = {
  id: number;
  item_id: number;
  text: string;
  created_at: number;
  /** When it went out; null = still a draft. */
  sent_at: number | null;
  /** The room it went to (omp room id or Claude session id) and that room's label then. */
  sent_to: string | null;
  sent_label: string | null;
};

export type CommentList = { drafts: ContentComment[]; sent: ContentComment[] };

/**
 * The one message a send makes: the item as the other content tasks quote it (title and page as data
 * lines), then the owner's comments numbered. The comments are the owner's own words: not quoted as
 * data. A comment's later lines are indented under its number.
 */
export function commentsTaskText(it: Pick<ContentItem, "id" | "title" | "fb_page">, texts: string[]): string {
  const list = texts.map((t, i) => `${i + 1}. ${t.trim().replace(/\r\n/g, "\n").split("\n").join("\n   ")}`);
  return contentTaskText(it, [`Góp ý của chủ (${texts.length}):`, ...list].join("\n"));
}
