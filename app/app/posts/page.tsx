import Link from "next/link";
import { all } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";
import { formatInZone } from "@/lib/time";
import { EmptyState, PageHeader, PlatformIcon, StatusBadge } from "@/components/ui";
import type { Platform } from "@/lib/types";

export const metadata = { title: "Posts" };

const FILTERS = ["all", "draft", "pending_approval", "scheduled", "published", "partially_published", "failed"];

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { workspace } = await requireWorkspace();
  const { status = "all" } = await searchParams;
  const posts = all<{
    id: string;
    master_text: string;
    status: string;
    scheduled_at: string | null;
    updated_at: string;
    author: string;
    platforms: string | null;
  }>(
    `SELECT p.id, p.master_text, p.status, p.scheduled_at, p.updated_at, u.name author, GROUP_CONCAT(v.platform) platforms
     FROM posts p JOIN users u ON u.id = p.author_id LEFT JOIN post_variants v ON v.post_id = p.id
     WHERE p.workspace_id = ? AND (? = 'all' OR p.status = ?)
     GROUP BY p.id ORDER BY COALESCE(p.scheduled_at, p.updated_at) DESC LIMIT 200`,
    workspace.id,
    status,
    status,
  );

  return (
    <>
      <PageHeader title="Posts" actions={<Link href="/app/compose" className="btn-primary">New post</Link>} />
      <div className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/app/posts?status=${f}`}
            className={`rounded-full px-3 py-1 text-sm capitalize ${status === f ? "bg-brand text-brand-ink" : "bg-surface-2 text-muted hover:text-text"}`}
          >
            {f.replace(/_/g, " ")}
          </Link>
        ))}
      </div>
      {posts.length === 0 ? (
        <EmptyState title="No posts here" body="Posts you create will show up here." />
      ) : (
        <div className="card divide-y divide-border">
          {posts.map((p) => (
            <Link key={p.id} href={`/app/compose?post=${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <div className="flex w-24 shrink-0 gap-1">
                {[...new Set((p.platforms ?? "").split(",").filter(Boolean))].map((pl) => (
                  <PlatformIcon key={pl} platform={pl as Platform} size={20} />
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{p.master_text || "(no text)"}</p>
                <p className="text-xs text-muted">
                  {p.author} · {p.scheduled_at ? formatInZone(p.scheduled_at, workspace.timezone) : `edited ${formatInZone(p.updated_at, workspace.timezone)}`}
                </p>
              </div>
              <StatusBadge status={p.status} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
