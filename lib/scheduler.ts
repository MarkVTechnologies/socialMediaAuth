import { all, get, run, now, parseJson, tx } from "./db";
import { decrypt, encrypt, id } from "./crypto";
import { adapterForAccount, PublishError } from "./publishers";
import { publicMediaUrl } from "./media";
import { audit, notify } from "./notify";
import { PLATFORMS } from "./platforms";
import { WHATSAPP_STATUS_DAILY_CAP } from "./publishers/whatsapp";
import type { MediaAsset, Post, PostStatus, PostVariant, SocialAccount } from "./types";

/**
 * Scheduler + publisher worker (PRD §6.4).
 * One job per target platform, due at the scheduled time. A worker loop claims due jobs,
 * refreshes tokens, calls the platform adapter, and retries temporary failures after
 * 1, 5 and 15 minutes. The job table is the queue; it can be replaced with BullMQ/Redis
 * without changing callers.
 */

const RETRY_DELAYS_MIN = [1, 5, 15];
const LOCK_MINUTES = 10;
const CONCURRENCY = 4;

interface Job {
  id: string;
  kind: "publish";
  variant_id: string;
  run_at: string;
  attempts: number;
  status: "queued" | "running" | "done" | "failed";
}

export function schedulePost(postId: string, at: Date) {
  const iso = at.toISOString();
  tx(() => {
    run("DELETE FROM jobs WHERE status = 'queued' AND variant_id IN (SELECT id FROM post_variants WHERE post_id = ?)", postId);
    run("UPDATE posts SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?", iso, now(), postId);
    const variants = all<{ id: string }>(
      "SELECT id FROM post_variants WHERE post_id = ? AND status != 'published'",
      postId,
    );
    for (const v of variants) {
      run("UPDATE post_variants SET status = 'scheduled', error_message = NULL WHERE id = ?", v.id);
      run(
        "INSERT INTO jobs (id, kind, variant_id, run_at, created_at) VALUES (?, 'publish', ?, ?, ?)",
        id("job_"),
        v.id,
        iso,
        now(),
      );
    }
  });
}

export function unschedulePost(postId: string, status: PostStatus = "draft") {
  tx(() => {
    run("DELETE FROM jobs WHERE status = 'queued' AND variant_id IN (SELECT id FROM post_variants WHERE post_id = ?)", postId);
    run("UPDATE post_variants SET status = 'draft' WHERE post_id = ? AND status = 'scheduled'", postId);
    run("UPDATE posts SET status = ?, updated_at = ? WHERE id = ?", status, now(), postId);
  });
}

/** Retry a single failed variant now. */
export function retryVariant(variantId: string) {
  tx(() => {
    run("UPDATE post_variants SET status = 'scheduled', error_message = NULL WHERE id = ?", variantId);
    run("INSERT INTO jobs (id, kind, variant_id, run_at, created_at) VALUES (?, 'publish', ?, ?, ?)", id("job_"), variantId, now(), now());
    const v = get<{ post_id: string }>("SELECT post_id FROM post_variants WHERE id = ?", variantId)!;
    run("UPDATE posts SET status = 'scheduled', updated_at = ? WHERE id = ?", now(), v.post_id);
  });
}

function claimDueJobs(limit: number): Job[] {
  return tx(() => {
    const t = now();
    // Reclaim jobs whose worker died mid-run.
    run("UPDATE jobs SET status = 'queued' WHERE status = 'running' AND locked_until < ?", t);
    const due = all<Job>(
      "SELECT * FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY run_at LIMIT ?",
      t,
      limit,
    );
    const lock = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
    for (const j of due) run("UPDATE jobs SET status = 'running', locked_until = ? WHERE id = ?", lock, j.id);
    return due;
  });
}

async function ensureFreshToken(account: SocialAccount): Promise<string | null> {
  const access = decrypt(account.access_token_enc);
  if (!account.token_expires_at) return access;
  const expiresSoon = new Date(account.token_expires_at).getTime() - Date.now() < 5 * 60000;
  if (!expiresSoon) return access;
  const adapter = adapterForAccount(account);
  const fresh = await adapter.refreshToken(account, decrypt(account.refresh_token_enc));
  if (!fresh?.accessToken) {
    throw new PublishError(`${PLATFORMS[account.platform].name} connection has expired. Reconnect the account.`, true, "reconnect");
  }
  run(
    `UPDATE social_accounts SET access_token_enc = ?, refresh_token_enc = COALESCE(?, refresh_token_enc),
     token_expires_at = ?, status = 'connected' WHERE id = ?`,
    encrypt(fresh.accessToken),
    fresh.refreshToken ? encrypt(fresh.refreshToken) : null,
    fresh.expiresAt ?? null,
    account.id,
  );
  return fresh.accessToken;
}

function refreshPostStatus(postId: string) {
  const rows = all<{ status: string }>("SELECT status FROM post_variants WHERE post_id = ?", postId);
  const s = new Set(rows.map((r) => r.status));
  let status: PostStatus;
  if (s.has("publishing") || s.has("scheduled")) status = s.has("publishing") ? "publishing" : "scheduled";
  else if (s.size === 1 && s.has("published")) status = "published";
  else if (s.has("published") && s.has("failed")) status = "partially_published";
  else if (s.has("failed")) status = "failed";
  else status = "draft";
  run("UPDATE posts SET status = ?, updated_at = ? WHERE id = ?", status, now(), postId);
  return status;
}

async function processJob(job: Job) {
  const variant = get<PostVariant>("SELECT * FROM post_variants WHERE id = ?", job.variant_id);
  if (!variant) return run("UPDATE jobs SET status = 'done' WHERE id = ?", job.id);
  const post = get<Post>("SELECT * FROM posts WHERE id = ?", variant.post_id)!;
  const account = get<SocialAccount>("SELECT * FROM social_accounts WHERE id = ?", variant.social_account_id);
  const ws = get<{ plan_status: string }>("SELECT plan_status FROM workspaces WHERE id = ?", post.workspace_id)!;

  if (ws.plan_status !== "active") {
    // Graceful downgrade: pause, don't delete. Re-check in an hour.
    run("UPDATE jobs SET status = 'queued', run_at = ? WHERE id = ?", new Date(Date.now() + 3600_000).toISOString(), job.id);
    return;
  }

  run("UPDATE post_variants SET status = 'publishing' WHERE id = ?", variant.id);
  refreshPostStatus(post.id);

  try {
    if (!account) throw new PublishError("The social account for this post was disconnected.", true, "reconnect");
    if (account.status === "disconnected")
      throw new PublishError(`${account.name} is disconnected. Reconnect it to publish.`, true, "reconnect");

    if (account.platform === "whatsapp_status") {
      const today = get<{ n: number }>(
        `SELECT COUNT(*) n FROM post_variants WHERE social_account_id = ? AND status = 'published' AND published_at >= ?`,
        account.id,
        new Date(Date.now() - 86400_000).toISOString(),
      )!.n;
      if (today >= WHATSAPP_STATUS_DAILY_CAP) {
        throw new PublishError(
          `Daily WhatsApp Status cap (${WHATSAPP_STATUS_DAILY_CAP}) reached to protect your number; will retry later.`,
          false,
        );
      }
    }

    const token = await ensureFreshToken(account);
    const mediaIds = parseJson<string[]>(post.media_ids, []);
    const media = mediaIds
      .map((mid) => get<MediaAsset>("SELECT * FROM media_assets WHERE id = ?", mid))
      .filter((m): m is MediaAsset => Boolean(m))
      .map((m) => ({ ...m, url: publicMediaUrl(m) }));

    const result = await adapterForAccount(account).publish({
      account,
      accessToken: token,
      variant,
      settings: parseJson(variant.settings_json, {}),
      media,
    });

    run(
      `UPDATE post_variants SET status = 'published', platform_post_id = ?, published_url = ?, error_message = NULL,
       published_at = ? WHERE id = ?`,
      result.platformPostId,
      result.url,
      now(),
      variant.id,
    );
    run("UPDATE jobs SET status = 'done', attempts = attempts + 1 WHERE id = ?", job.id);
    audit("post.published", {
      workspaceId: post.workspace_id,
      target: variant.id,
      details: { platform: variant.platform, url: result.url },
    });
  } catch (e) {
    const err = e instanceof PublishError ? e : new PublishError((e as Error).message || "Unknown error", false);
    const attempts = job.attempts + 1;
    const delay = RETRY_DELAYS_MIN[attempts - 1];
    if (!err.permanent && delay !== undefined) {
      run(
        "UPDATE jobs SET status = 'queued', attempts = ?, run_at = ?, last_error = ? WHERE id = ?",
        attempts,
        new Date(Date.now() + delay * 60000).toISOString(),
        err.message,
        job.id,
      );
      run("UPDATE post_variants SET status = 'scheduled', error_message = ? WHERE id = ?", `Retrying: ${err.message}`, variant.id);
    } else {
      run("UPDATE jobs SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?", attempts, err.message, job.id);
      run("UPDATE post_variants SET status = 'failed', error_message = ? WHERE id = ?", err.message, variant.id);
      if (err.fix === "reconnect" && account) {
        run("UPDATE social_accounts SET status = 'disconnected' WHERE id = ?", account.id);
      }
      const fixLink =
        err.fix === "reconnect" ? "/app/accounts" : `/app/compose?post=${post.id}`;
      await notify(post.workspace_id, {
        title: `Post failed on ${PLATFORMS[variant.platform].name}`,
        body: err.message,
        link: fixLink,
        level: "error",
        email: true,
      });
    }
  } finally {
    const status = refreshPostStatus(post.id);
    if ((status === "published" || status === "partially_published") && post.recurrence) {
      scheduleNextOccurrence(post);
    }
  }
}

/** Recurring posts: when an occurrence finishes, clone it for the next date. */
function scheduleNextOccurrence(post: Post) {
  if (!post.scheduled_at || !post.recurrence) return;
  const exists = get("SELECT 1 FROM posts WHERE workspace_id = ? AND recurrence = ? AND scheduled_at > ? AND master_text = ?",
    post.workspace_id, post.recurrence, post.scheduled_at, post.master_text);
  if (exists) return;
  const next = new Date(post.scheduled_at);
  if (post.recurrence === "daily") next.setUTCDate(next.getUTCDate() + 1);
  else if (post.recurrence === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else if (post.recurrence === "monthly") next.setUTCMonth(next.getUTCMonth() + 1);
  else return;
  const newId = id("post_");
  tx(() => {
    run(
      `INSERT INTO posts (id, workspace_id, author_id, master_text, hint, language, media_ids, status, scheduled_at, recurrence, created_at, updated_at)
       SELECT ?, workspace_id, author_id, master_text, hint, language, media_ids, 'draft', NULL, recurrence, ?, ? FROM posts WHERE id = ?`,
      newId, now(), now(), post.id,
    );
    run(
      `INSERT INTO post_variants (id, post_id, platform, social_account_id, text, title, tags, settings_json, ai_generated, locked)
       SELECT 'pv_' || lower(hex(randomblob(9))), ?, platform, social_account_id, text, title, tags, settings_json, ai_generated, locked
       FROM post_variants WHERE post_id = ?`,
      newId, post.id,
    );
  });
  schedulePost(newId, next);
}

// ---- Account health + metrics ----

async function checkAccountHealth() {
  const soon = new Date(Date.now() + 3 * 86400_000).toISOString();
  const expiring = all<SocialAccount>(
    `SELECT * FROM social_accounts WHERE status = 'connected' AND token_expires_at IS NOT NULL AND token_expires_at < ?`,
    soon,
  );
  for (const a of expiring) {
    try {
      if (a.refresh_token_enc) {
        await ensureFreshToken({ ...a, token_expires_at: new Date().toISOString() });
        continue;
      }
    } catch {
      // fall through to marking expiring
    }
    run("UPDATE social_accounts SET status = 'expiring' WHERE id = ?", a.id);
    await notify(a.workspace_id, {
      title: `${a.name} needs reconnecting`,
      body: `Your ${PLATFORMS[a.platform].name} connection expires soon. Reconnect to keep scheduled posts publishing.`,
      link: "/app/accounts",
      level: "warning",
      email: true,
    });
  }
}

async function syncMetrics(limit = 20) {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const stale = new Date(Date.now() - 6 * 3600_000).toISOString();
  const rows = all<PostVariant & { last: string | null }>(
    `SELECT v.*, (SELECT MAX(collected_at) FROM metric_snapshots m WHERE m.variant_id = v.id) AS last
     FROM post_variants v WHERE v.status = 'published' AND v.platform_post_id IS NOT NULL AND v.published_at >= ?
     ORDER BY last IS NOT NULL, last LIMIT ?`,
    since,
    limit,
  );
  for (const v of rows) {
    if (v.last && v.last > stale) continue;
    const account = get<SocialAccount>("SELECT * FROM social_accounts WHERE id = ?", v.social_account_id);
    if (!account || account.status === "disconnected") continue;
    const adapter = adapterForAccount(account);
    if (!adapter.getMetrics) continue;
    try {
      const m = await adapter.getMetrics(account, decrypt(account.access_token_enc), v.platform_post_id!);
      run(
        `INSERT INTO metric_snapshots (id, variant_id, collected_at, views, likes, comments, shares, saves, clicks, watch_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id("ms_"), v.id, now(),
        m.views ?? null, m.likes ?? null, m.comments ?? null, m.shares ?? null, m.saves ?? null, m.clicks ?? null, m.watchTime ?? null,
      );
    } catch (e) {
      console.warn("[metrics]", v.id, (e as Error).message);
    }
  }
}

// ---- Worker loop ----

let running = false;
let lastHousekeeping = 0;

export async function tick() {
  if (running) return;
  running = true;
  try {
    const jobs = claimDueJobs(CONCURRENCY * 4);
    for (let i = 0; i < jobs.length; i += CONCURRENCY) {
      await Promise.all(
        jobs.slice(i, i + CONCURRENCY).map((j) =>
          processJob(j).catch((e) => {
            console.error("[worker] job crashed", j.id, e);
            run("UPDATE jobs SET status = 'queued', run_at = ? WHERE id = ?", new Date(Date.now() + 60000).toISOString(), j.id);
          }),
        ),
      );
    }
    if (Date.now() - lastHousekeeping > 15 * 60000) {
      lastHousekeeping = Date.now();
      await checkAccountHealth();
      await syncMetrics();
    }
  } finally {
    running = false;
  }
}

declare global {
  var __smaWorker: NodeJS.Timeout | undefined;
}

export function startWorker(intervalMs = 15000) {
  if (globalThis.__smaWorker) return;
  console.log(`[worker] publisher worker started (every ${intervalMs / 1000}s)`);
  globalThis.__smaWorker = setInterval(() => void tick().catch((e) => console.error("[worker]", e)), intervalMs);
}

export function queueStats() {
  return {
    byStatus: all<{ status: string; n: number }>("SELECT status, COUNT(*) n FROM jobs GROUP BY status"),
    byPlatform: all<{ platform: string; status: string; n: number }>(
      `SELECT platform, status, COUNT(*) n FROM post_variants
       WHERE status IN ('published','failed') GROUP BY platform, status`,
    ),
    overdue: get<{ n: number }>("SELECT COUNT(*) n FROM jobs WHERE status = 'queued' AND run_at < ?", new Date(Date.now() - 120000).toISOString())!.n,
  };
}
