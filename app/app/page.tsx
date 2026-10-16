import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { all, get, parseJson } from "@/lib/db";
import { getUsage, requireWorkspace } from "@/lib/workspace";
import { PLANS } from "@/lib/plans";
import { daysAgo, formatInZone } from "@/lib/time";
import { Badge, Meter, PageHeader, PlatformIcon, StatusBadge } from "@/components/ui";
import type { BrandProfile, Platform } from "@/lib/types";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const { workspace, user } = await requireWorkspace();
  const usage = getUsage(workspace.id);
  const plan = PLANS[workspace.plan];
  const brand = parseJson<BrandProfile>(workspace.brand_json, {});

  const upcoming = all<{ id: string; master_text: string; scheduled_at: string; status: string; platforms: string }>(
    `SELECT p.id, p.master_text, p.scheduled_at, p.status, GROUP_CONCAT(v.platform) platforms
     FROM posts p LEFT JOIN post_variants v ON v.post_id = p.id
     WHERE p.workspace_id = ? AND p.status IN ('scheduled','pending_approval','publishing') AND p.scheduled_at IS NOT NULL
     GROUP BY p.id ORDER BY p.scheduled_at LIMIT 6`,
    workspace.id,
  );
  const failed = all<{ post_id: string; platform: Platform; error_message: string; account_name: string }>(
    `SELECT v.post_id, v.platform, v.error_message, a.name account_name FROM post_variants v
     JOIN posts p ON p.id = v.post_id JOIN social_accounts a ON a.id = v.social_account_id
     WHERE p.workspace_id = ? AND v.status = 'failed' ORDER BY p.updated_at DESC LIMIT 5`,
    workspace.id,
  );
  const stats = get<{ published: number; scheduled: number }>(
    `SELECT SUM(CASE WHEN v.status='published' AND v.published_at >= ? THEN 1 ELSE 0 END) published,
            SUM(CASE WHEN v.status='scheduled' THEN 1 ELSE 0 END) scheduled
     FROM post_variants v JOIN posts p ON p.id = v.post_id WHERE p.workspace_id = ?`,
    daysAgo(7),
    workspace.id,
  )!;
  const unhealthy = get<{ n: number }>(
    "SELECT COUNT(*) n FROM social_accounts WHERE workspace_id = ? AND status != 'connected'",
    workspace.id,
  )!.n;
  const hasPost = Boolean(get("SELECT 1 FROM posts WHERE workspace_id = ? LIMIT 1", workspace.id));
  const hasScheduled = Boolean(
    get("SELECT 1 FROM posts WHERE workspace_id = ? AND status IN ('scheduled','published','partially_published') LIMIT 1", workspace.id),
  );

  const checklist = [
    { done: Boolean(brand.industry && brand.audience), label: "Complete your brand profile", href: "/app/settings" },
    { done: usage.accounts > 0, label: "Connect a social account", href: "/app/accounts" },
    { done: usage.storageBytes > 0, label: "Upload media to your library", href: "/app/media" },
    { done: hasPost, label: "Write and AI-optimise your first post", href: "/app/compose" },
    { done: hasScheduled, label: "Schedule it", href: "/app/calendar" },
  ];
  const remaining = checklist.filter((c) => !c.done).length;

  return (
    <>
      <PageHeader
        title={`Good day, ${user.name.split(" ")[0]}`}
        description={`Here's what's happening at ${workspace.name}.`}
        actions={<Link href="/app/compose" className="btn-primary">New post</Link>}
      />

      {remaining > 0 && (
        <section className="card mb-6 p-5">
          <h2 className="font-medium">Get set up — {checklist.length - remaining} of {checklist.length} done</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {checklist.map((c) => (
              <li key={c.label}>
                <Link href={c.href} className="flex items-center gap-2 text-sm hover:text-brand">
                  {c.done ? <CheckCircle2 size={18} className="text-ok" /> : <Circle size={18} className="text-muted" />}
                  <span className={c.done ? "text-muted line-through" : ""}>{c.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-sm text-muted">Published (7 days)</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{stats.published ?? 0}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-muted">Scheduled</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{stats.scheduled ?? 0}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-muted">Account health</p>
          <p className="mt-1 text-3xl font-semibold">
            {usage.accounts === 0 ? "—" : unhealthy === 0 ? <span className="text-ok">All good</span> : <span className="text-danger">{unhealthy} need attention</span>}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Coming up</h2>
            <Link href="/app/calendar" className="text-sm text-brand">Calendar →</Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">Nothing scheduled yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map((p) => (
                <li key={p.id}>
                  <Link href={`/app/compose?post=${p.id}`} className="flex items-center gap-3 py-3">
                    <div className="flex gap-1">
                      {[...new Set((p.platforms ?? "").split(",").filter(Boolean))].map((pl) => (
                        <PlatformIcon key={pl} platform={pl as Platform} size={20} />
                      ))}
                    </div>
                    <p className="min-w-0 flex-1 truncate text-sm">{p.master_text || "(no text)"}</p>
                    <span className="hidden text-xs text-muted sm:block">{formatInZone(p.scheduled_at, workspace.timezone)}</span>
                    <StatusBadge status={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {failed.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-sm font-medium text-danger">Needs your attention</h3>
              <ul className="space-y-2">
                {failed.map((f) => (
                  <li key={f.post_id + f.platform}>
                    <Link href={`/app/compose?post=${f.post_id}`} className="flex items-start gap-3 rounded-lg bg-danger-soft p-3 text-sm">
                      <PlatformIcon platform={f.platform} size={20} />
                      <span className="flex-1 text-danger">
                        <b>{f.account_name}:</b> {f.error_message}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">This month</h2>
            <Badge tone="brand">{plan.name}</Badge>
          </div>
          <Meter label="Scheduled posts" used={usage.posts} limit={plan.postsPerMonth} />
          <Meter label="AI optimisations" used={usage.ai} limit={plan.aiPerMonth} />
          <Meter label="Connected accounts" used={usage.accounts} limit={plan.accounts} />
          <Meter label="Storage (MB)" used={Math.round(usage.storageBytes / 1024 ** 2)} limit={plan.storageGb * 1024} />
          <Link href="/app/billing" className="btn-secondary w-full">Manage plan</Link>
        </section>
      </div>
    </>
  );
}
