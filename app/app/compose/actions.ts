"use server";

import { revalidatePath } from "next/cache";
import { get, run, now } from "@/lib/db";
import { id, randomToken } from "@/lib/crypto";
import { optimise, aiConfigured } from "@/lib/ai";
import { appUrl, audit, notify } from "@/lib/notify";
import {
  getMedia,
  getPost,
  getWorkspaceAccounts,
  hasBlockingIssues,
  nextQueueSlot,
  savePost,
  validatePost,
  type PostInput,
  type VariantInput,
} from "@/lib/posts";
import { retryVariant, schedulePost, unschedulePost } from "@/lib/scheduler";
import { zonedLocalToUtc } from "@/lib/time";
import { can, checkLimit, incrementUsage, requireRole, requireWorkspace } from "@/lib/workspace";
import type { Platform } from "@/lib/types";

export interface ActionResult {
  ok: boolean;
  error?: string;
  postId?: string;
  status?: string;
  message?: string;
}

export async function saveDraftAction(input: PostInput): Promise<ActionResult> {
  const ctx = await requireRole(can.createDraft);
  const postId = savePost(ctx.workspace.id, ctx.user.id, input);
  const post = getPost(ctx.workspace.id, postId)!;
  if (post.status === "scheduled") unschedulePost(postId);
  audit("post.saved", { workspaceId: ctx.workspace.id, actorId: ctx.user.id, target: postId });
  revalidatePath("/app", "layout");
  return { ok: true, postId, status: "draft", message: "Draft saved" };
}

export interface OptimiseResponse extends ActionResult {
  variants?: VariantInput[];
  flags?: { severity: "warning" | "block"; message: string }[];
  notes?: Partial<Record<Platform, string>>;
  offline?: boolean;
}

export async function optimiseAction(input: PostInput): Promise<OptimiseResponse> {
  const ctx = await requireRole(can.createDraft);
  if (!input.masterText.trim()) return { ok: false, error: "Write your master draft first." };
  const limit = checkLimit(ctx.workspace, "ai");
  if (limit) return { ok: false, error: limit };

  const accounts = getWorkspaceAccounts(ctx.workspace.id);
  const selected = input.variants
    .map((v) => ({ v, a: accounts.find((a) => a.id === v.accountId) }))
    .filter((x): x is { v: VariantInput; a: (typeof accounts)[number] } => Boolean(x.a));
  const platforms = [...new Set(selected.filter((x) => !x.v.locked).map((x) => x.a.platform))];
  if (platforms.length === 0) return { ok: false, error: "Select at least one unlocked account to optimise." };

  const media = getMedia(ctx.workspace.id, input.mediaIds);
  let result;
  try {
    result = await optimise({
      masterText: input.masterText,
      hint: input.hint,
      language: input.language || "en-NG",
      brand: ctx.brand,
      platforms,
      media,
    });
  } catch (e) {
    console.error("[ai]", e);
    return { ok: false, error: (e as Error).message || "AI optimisation failed. Please try again." };
  }

  const byPlatform = new Map(result.output.variants.map((v) => [v.platform, v]));
  const variants: VariantInput[] = selected.map(({ v, a }) => {
    const ai = byPlatform.get(a.platform);
    if (v.locked || !ai) return v;
    return {
      ...v,
      text: ai.text,
      title: ai.title ?? v.title ?? null,
      tags: ai.tags.length ? ai.tags.join(", ") : v.tags ?? null,
      settings: { ...(v.settings ?? {}), ...(ai.alt_text ? { altText: ai.alt_text } : {}) },
      aiGenerated: true,
    };
  });

  const postId = savePost(ctx.workspace.id, ctx.user.id, { ...input, variants });
  if (result.model !== "heuristic") incrementUsage(ctx.workspace.id, "ai_optimisations");
  run(
    "INSERT INTO ai_generations (id, workspace_id, post_id, output_json, model, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id("ai_"), ctx.workspace.id, postId, JSON.stringify(result.output), result.model, result.inputTokens, result.outputTokens, now(),
  );
  return {
    ok: true,
    postId,
    variants,
    flags: result.output.policy_flags,
    notes: Object.fromEntries(result.output.variants.map((v) => [v.platform, v.notes])),
    offline: !aiConfigured(),
  };
}

export async function submitAction(
  input: PostInput,
  mode: "now" | "schedule" | "queue",
  localTime?: string,
): Promise<ActionResult & { issues?: ReturnType<typeof validatePost> }> {
  const ctx = await requireRole(can.createDraft);
  if (input.variants.length === 0) return { ok: false, error: "Select at least one account." };
  if (input.variants.some((v) => !v.text.trim() && !input.mediaIds.length))
    return { ok: false, error: "Every selected account needs text or media." };

  const accounts = getWorkspaceAccounts(ctx.workspace.id);
  const platforms = input.variants
    .map((v) => accounts.find((a) => a.id === v.accountId)?.platform)
    .filter((p): p is Platform => Boolean(p));
  const issues = validatePost(ctx.workspace.id, input.mediaIds, platforms);
  if (hasBlockingIssues(issues)) return { ok: false, error: "Fix the media problems shown before scheduling.", issues };

  let at: Date;
  if (mode === "now") at = new Date();
  else if (mode === "queue") {
    const slot = nextQueueSlot(ctx.workspace.id, ctx.workspace.timezone);
    if (!slot) return { ok: false, error: "No queue time slots set. Add them in Brand & settings." };
    at = slot;
  } else {
    if (!localTime) return { ok: false, error: "Pick a date and time." };
    at = zonedLocalToUtc(localTime, ctx.workspace.timezone);
    if (at.getTime() < Date.now() - 60000) return { ok: false, error: "That time is in the past." };
  }

  const existing = input.postId ? getPost(ctx.workspace.id, input.postId) : undefined;
  const alreadyCounted = existing && ["scheduled", "pending_approval", "published", "partially_published", "failed"].includes(existing.status);
  if (!alreadyCounted) {
    const limit = checkLimit(ctx.workspace, "posts");
    if (limit) return { ok: false, error: limit };
  }

  const postId = savePost(ctx.workspace.id, ctx.user.id, input);
  if (!alreadyCounted) incrementUsage(ctx.workspace.id, "posts");

  const needsApproval = !can.schedule(ctx.role) || (ctx.workspace.require_approval === 1 && !can.approve(ctx.role));
  if (needsApproval) {
    unschedulePost(postId, "pending_approval");
    run("UPDATE posts SET scheduled_at = ? WHERE id = ?", at.toISOString(), postId);
    audit("post.submitted_for_approval", { workspaceId: ctx.workspace.id, actorId: ctx.user.id, target: postId });
    await notify(ctx.workspace.id, {
      title: "Post waiting for approval",
      body: `${ctx.user.name} submitted a post for approval.`,
      link: "/app/approvals",
    });
    revalidatePath("/app", "layout");
    return { ok: true, postId, status: "pending_approval", message: "Sent for approval" };
  }

  schedulePost(postId, at);
  audit(mode === "now" ? "post.publish_now" : "post.scheduled", {
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    target: postId,
    details: { at: at.toISOString() },
  });
  revalidatePath("/app", "layout");
  return {
    ok: true,
    postId,
    status: "scheduled",
    message: mode === "now" ? "Publishing now…" : "Scheduled",
  };
}

export async function deletePostAction(postId: string): Promise<ActionResult> {
  const ctx = await requireRole(can.createDraft);
  const post = getPost(ctx.workspace.id, postId);
  if (!post) return { ok: false, error: "Post not found" };
  if (!can.schedule(ctx.role) && post.author_id !== ctx.user.id) return { ok: false, error: "You can only delete your own drafts." };
  run("DELETE FROM jobs WHERE variant_id IN (SELECT id FROM post_variants WHERE post_id = ?)", postId);
  run("DELETE FROM posts WHERE id = ?", postId);
  audit("post.deleted", { workspaceId: ctx.workspace.id, actorId: ctx.user.id, target: postId });
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function retryVariantAction(variantId: string): Promise<ActionResult> {
  const ctx = await requireRole(can.schedule);
  const owns = get(
    "SELECT 1 FROM post_variants v JOIN posts p ON p.id = v.post_id WHERE v.id = ? AND p.workspace_id = ?",
    variantId,
    ctx.workspace.id,
  );
  if (!owns) return { ok: false, error: "Not found" };
  retryVariant(variantId);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Retrying now" };
}

export async function createApprovalLinkAction(postId: string): Promise<ActionResult & { url?: string }> {
  const ctx = await requireWorkspace();
  if (!getPost(ctx.workspace.id, postId)) return { ok: false, error: "Save the post first." };
  const token = randomToken(24);
  run(
    "INSERT INTO approval_links (token, post_id, created_by, expires_at) VALUES (?, ?, ?, ?)",
    token,
    postId,
    ctx.user.id,
    new Date(Date.now() + 14 * 86400_000).toISOString(),
  );
  return { ok: true, url: `${appUrl()}/approve/${token}` };
}
