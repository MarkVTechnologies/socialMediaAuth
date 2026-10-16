import { get, run, now } from "./db";
import { id } from "./crypto";
import { audit, notify } from "./notify";
import { schedulePost, unschedulePost } from "./scheduler";
import type { Post } from "./types";

/** Record an approval decision. Approved posts are scheduled for their requested time (or ASAP). */
export async function decide(post: Post, approver: string, decision: "approved" | "rejected", comment: string, actorId?: string) {
  run(
    "INSERT INTO approvals (id, post_id, approver, decision, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id("apr_"),
    post.id,
    approver,
    decision,
    comment,
    now(),
  );
  // Only posts submitted for approval are scheduled on approval; a draft shared for
  // feedback just records the decision and stays a draft.
  if (post.status === "pending_approval") {
    if (decision === "approved") {
      const at = post.scheduled_at && new Date(post.scheduled_at) > new Date() ? new Date(post.scheduled_at) : new Date();
      schedulePost(post.id, at);
    } else {
      unschedulePost(post.id, "draft");
    }
  }
  audit(`post.${decision}`, { workspaceId: post.workspace_id, actorId: actorId ?? null, target: post.id, details: { approver, comment } });
  await notify(post.workspace_id, {
    title: decision === "approved" ? "Post approved" : "Post rejected",
    body: `${approver} ${decision} a post${comment ? `: “${comment}”` : "."}`,
    link: `/app/compose?post=${post.id}`,
    level: decision === "approved" ? "success" : "warning",
    email: decision === "rejected",
  });
}

export function postForApprovalToken(token: string) {
  const link = get<{ post_id: string; expires_at: string }>("SELECT * FROM approval_links WHERE token = ?", token);
  if (!link || link.expires_at < now()) return null;
  return get<Post>("SELECT * FROM posts WHERE id = ?", link.post_id) ?? null;
}
