import { all } from "./db";
import type { Platform } from "./types";

export interface VariantMetrics {
  id: string;
  post_id: string;
  platform: Platform;
  account_name: string;
  text: string;
  published_url: string | null;
  published_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

/** Latest snapshot per published variant within the window. */
export function loadMetrics(workspaceId: string, since: string) {
  return all<VariantMetrics>(
    `SELECT v.id, v.post_id, v.platform, a.name account_name, v.text, v.published_url, v.published_at,
            m.views, m.likes, m.comments, m.shares
     FROM post_variants v
     JOIN posts p ON p.id = v.post_id
     JOIN social_accounts a ON a.id = v.social_account_id
     LEFT JOIN metric_snapshots m ON m.id = (SELECT id FROM metric_snapshots WHERE variant_id = v.id ORDER BY collected_at DESC LIMIT 1)
     WHERE p.workspace_id = ? AND v.status = 'published' AND v.published_at >= ?
     ORDER BY v.published_at DESC`,
    workspaceId,
    since,
  );
}

export function summarise(rows: VariantMetrics[]) {
  const sum = (k: "views" | "likes" | "comments" | "shares") => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  const views = sum("views");
  const engagements = sum("likes") + sum("comments") + sum("shares");
  const byPlatform = new Map<Platform, { posts: number; views: number; engagements: number }>();
  for (const r of rows) {
    const e = byPlatform.get(r.platform) ?? { posts: 0, views: 0, engagements: 0 };
    e.posts++;
    e.views += r.views ?? 0;
    e.engagements += (r.likes ?? 0) + (r.comments ?? 0) + (r.shares ?? 0);
    byPlatform.set(r.platform, e);
  }
  const top = [...rows].sort((a, b) => (b.likes ?? 0) + (b.comments ?? 0) + (b.shares ?? 0) - ((a.likes ?? 0) + (a.comments ?? 0) + (a.shares ?? 0))).slice(0, 5);
  return { posts: rows.length, views, engagements, rate: views ? (engagements / views) * 100 : null, byPlatform, top };
}
