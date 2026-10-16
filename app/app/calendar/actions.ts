"use server";

import { revalidatePath } from "next/cache";
import { run, now } from "@/lib/db";
import { audit } from "@/lib/notify";
import { getPost } from "@/lib/posts";
import { schedulePost } from "@/lib/scheduler";
import { utcToZonedLocal, zonedLocalToUtc } from "@/lib/time";
import { can, requireRole } from "@/lib/workspace";

/** Drag-to-reschedule: move a post to another day, keeping its time of day. */
export async function reschedulePost(postId: string, ymd: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRole(can.schedule);
  const post = getPost(ctx.workspace.id, postId);
  if (!post) return { ok: false, error: "Post not found" };
  if (!["scheduled", "draft", "pending_approval", "failed"].includes(post.status))
    return { ok: false, error: "Published posts can't be moved." };
  const time = post.scheduled_at ? utcToZonedLocal(post.scheduled_at, ctx.workspace.timezone).slice(11, 16) : "09:00";
  const at = zonedLocalToUtc(`${ymd}T${time}`, ctx.workspace.timezone);
  if (at.getTime() < Date.now()) return { ok: false, error: "That time is in the past." };

  if (post.status === "scheduled" || post.status === "failed") schedulePost(post.id, at);
  else run("UPDATE posts SET scheduled_at = ?, updated_at = ? WHERE id = ?", at.toISOString(), now(), post.id);
  audit("post.rescheduled", { workspaceId: ctx.workspace.id, actorId: ctx.user.id, target: post.id, details: { at: at.toISOString() } });
  revalidatePath("/app/calendar");
  return { ok: true };
}
