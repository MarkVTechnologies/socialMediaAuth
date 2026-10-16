import { all, get, run, now, parseJson, tx } from "./db";
import { id } from "./crypto";
import { validateForPlatform, type MediaIssue } from "./media";
import { utcToZonedLocal, zonedLocalToUtc } from "./time";
import type { MediaAsset, Platform, Post, PostVariant, SocialAccount } from "./types";

export interface VariantInput {
  accountId: string;
  text: string;
  title?: string | null;
  tags?: string | null;
  settings?: Record<string, unknown>;
  locked?: boolean;
  aiGenerated?: boolean;
}

export interface PostInput {
  postId?: string | null;
  masterText: string;
  hint?: string;
  language?: string;
  mediaIds: string[];
  recurrence?: string | null;
  variants: VariantInput[];
}

export function getPost(workspaceId: string, postId: string) {
  return get<Post>("SELECT * FROM posts WHERE id = ? AND workspace_id = ?", postId, workspaceId);
}

export function getVariants(postId: string) {
  return all<PostVariant & { account_name: string }>(
    `SELECT v.*, a.name AS account_name FROM post_variants v
     JOIN social_accounts a ON a.id = v.social_account_id WHERE v.post_id = ? ORDER BY v.platform`,
    postId,
  );
}

export function getWorkspaceAccounts(workspaceId: string) {
  return all<SocialAccount>("SELECT * FROM social_accounts WHERE workspace_id = ? ORDER BY platform, name", workspaceId);
}

export function getMedia(workspaceId: string, ids: string[]): MediaAsset[] {
  if (ids.length === 0) return [];
  const rows = all<MediaAsset>(
    `SELECT * FROM media_assets WHERE workspace_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
    workspaceId,
    ...ids,
  );
  return ids.map((i) => rows.find((r) => r.id === i)).filter((m): m is MediaAsset => Boolean(m));
}

/** Create or update a post and its per-account variants. Published variants are left untouched. */
export function savePost(workspaceId: string, authorId: string, input: PostInput): string {
  const accounts = getWorkspaceAccounts(workspaceId);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const mediaIds = getMedia(workspaceId, input.mediaIds).map((m) => m.id);

  return tx(() => {
    let postId = input.postId ?? null;
    if (postId && !getPost(workspaceId, postId)) postId = null;
    if (!postId) {
      postId = id("post_");
      run(
        `INSERT INTO posts (id, workspace_id, author_id, master_text, hint, language, media_ids, recurrence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        postId, workspaceId, authorId, input.masterText, input.hint ?? "", input.language ?? "en-NG",
        JSON.stringify(mediaIds), input.recurrence || null, now(), now(),
      );
    } else {
      run(
        `UPDATE posts SET master_text = ?, hint = ?, language = ?, media_ids = ?, recurrence = ?, updated_at = ? WHERE id = ?`,
        input.masterText, input.hint ?? "", input.language ?? "en-NG", JSON.stringify(mediaIds),
        input.recurrence || null, now(), postId,
      );
    }

    const keep = new Set<string>();
    for (const v of input.variants) {
      const account = byId.get(v.accountId);
      if (!account) continue;
      keep.add(account.id);
      run(
        `INSERT INTO post_variants (id, post_id, platform, social_account_id, text, title, tags, settings_json, ai_generated, locked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (post_id, social_account_id) DO UPDATE SET
           text = excluded.text, title = excluded.title, tags = excluded.tags, settings_json = excluded.settings_json,
           ai_generated = excluded.ai_generated, locked = excluded.locked
         WHERE post_variants.status != 'published'`,
        id("pv_"), postId, account.platform, account.id, v.text, v.title ?? null, v.tags ?? null,
        JSON.stringify(v.settings ?? {}), v.aiGenerated ? 1 : 0, v.locked ? 1 : 0,
      );
    }
    const existing = all<{ id: string; social_account_id: string; status: string }>(
      "SELECT id, social_account_id, status FROM post_variants WHERE post_id = ?",
      postId,
    );
    for (const e of existing) {
      if (!keep.has(e.social_account_id) && e.status !== "published") {
        run("DELETE FROM jobs WHERE variant_id = ? AND status = 'queued'", e.id);
        run("DELETE FROM post_variants WHERE id = ?", e.id);
      }
    }
    return postId;
  });
}

export function validatePost(workspaceId: string, mediaIds: string[], platforms: Platform[]) {
  const media = getMedia(workspaceId, mediaIds);
  const out: Partial<Record<Platform, MediaIssue[]>> = {};
  for (const p of new Set(platforms)) out[p] = validateForPlatform(p, media);
  return out;
}

export function hasBlockingIssues(issues: Partial<Record<Platform, MediaIssue[]>>) {
  return Object.values(issues).some((list) => list?.some((i) => i.level === "error"));
}

export function postHistory(postId: string) {
  const approvals = all<{ approver: string; decision: string; comment: string; created_at: string }>(
    "SELECT approver, decision, comment, created_at FROM approvals WHERE post_id = ? ORDER BY created_at",
    postId,
  );
  const logs = all<{ action: string; actor_name: string | null; created_at: string; details: string }>(
    `SELECT l.action, u.name AS actor_name, l.created_at, l.details FROM audit_logs l
     LEFT JOIN users u ON u.id = l.actor_id
     WHERE l.target = ? OR l.target IN (SELECT id FROM post_variants WHERE post_id = ?) ORDER BY l.created_at`,
    postId,
    postId,
  );
  return { approvals, logs: logs.map((l) => ({ ...l, details: parseJson<Record<string, unknown>>(l.details, {}) })) };
}

/** Next free queue slot (workspace-defined weekday/time slots) after `from`. */
export function nextQueueSlot(workspaceId: string, timeZone: string, from = new Date()): Date | null {
  const slots = all<{ weekday: number; time: string }>("SELECT weekday, time FROM queue_slots WHERE workspace_id = ?", workspaceId);
  if (slots.length === 0) return null;
  const taken = new Set(
    all<{ scheduled_at: string }>(
      "SELECT scheduled_at FROM posts WHERE workspace_id = ? AND status IN ('scheduled','pending_approval') AND scheduled_at > ?",
      workspaceId,
      from.toISOString(),
    ).map((r) => r.scheduled_at.slice(0, 16)),
  );
  const localToday = utcToZonedLocal(from.toISOString(), timeZone).slice(0, 10);
  for (let day = 0; day < 60; day++) {
    const d = new Date(localToday + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + day);
    const ymd = d.toISOString().slice(0, 10);
    const weekday = d.getUTCDay();
    const daySlots = slots.filter((s) => s.weekday === weekday).sort((a, b) => a.time.localeCompare(b.time));
    for (const s of daySlots) {
      const at = zonedLocalToUtc(`${ymd}T${s.time}`, timeZone);
      if (at > from && !taken.has(at.toISOString().slice(0, 16))) return at;
    }
  }
  return null;
}

/** "Best time" defaults before engagement data exists (Africa/Lagos audiences). */
export const DEFAULT_BEST_TIMES: Record<Platform, string> = {
  facebook: "Weekdays 12:00–14:00 and 19:00–21:00",
  instagram: "Weekdays 11:00–13:00 and 19:00–21:00",
  linkedin: "Tue–Thu 08:00–10:00",
  youtube: "Fri–Sun 14:00–17:00",
  tiktok: "Daily 18:00–22:00",
  whatsapp_status: "Daily 07:00–09:00 and 20:00–22:00",
};
