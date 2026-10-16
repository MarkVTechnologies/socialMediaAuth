import Link from "next/link";
import { loadMetrics, summarise } from "@/lib/analytics";
import { requireWorkspace } from "@/lib/workspace";
import { daysAgo } from "@/lib/time";
import { PLANS } from "@/lib/plans";
import { PLATFORMS } from "@/lib/platforms";
import { Alert, EmptyState, PageHeader, PlatformIcon } from "@/components/ui";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { workspace } = await requireWorkspace();
  const { days: d = "30" } = await searchParams;
  const days = [7, 30, 90].includes(Number(d)) ? Number(d) : 30;
  const rows = loadMetrics(workspace.id, daysAgo(days));
  const s = summarise(rows);
  const plan = PLANS[workspace.plan];
  const maxEng = Math.max(1, ...[...s.byPlatform.values()].map((v) => v.engagements));

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Metrics are pulled from each platform every few hours where the platform allows it."
        actions={
          <>
            {[7, 30, 90].map((n) => (
              <Link key={n} href={`/app/analytics?days=${n}`} className={n === days ? "btn-primary px-3 py-1.5" : "btn-secondary px-3 py-1.5"}>
                {n}d
              </Link>
            ))}
            <Link href="/app/analytics/report" className="btn-secondary px-3 py-1.5">Monthly report</Link>
          </>
        }
      />
      {!plan.analytics && workspace.plan !== "trial" && (
        <div className="mb-4">
          <Alert tone="brand">Full analytics are included on Growth and Agency. <Link href="/app/billing" className="underline">Upgrade</Link></Alert>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No published posts yet" body="Once your posts go live, views and engagement will show up here." />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Posts published", s.posts.toLocaleString()],
              ["Views", s.views.toLocaleString()],
              ["Engagements", s.engagements.toLocaleString()],
              ["Engagement rate", s.rate === null ? "—" : `${s.rate.toFixed(1)}%`],
            ].map(([k, v]) => (
              <div key={k} className="card p-5">
                <p className="text-sm text-muted">{k}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card p-5">
              <h2 className="mb-4 font-medium">Engagement by platform</h2>
              <div className="space-y-3">
                {[...s.byPlatform.entries()].map(([p, v]) => (
                  <div key={p} className="flex items-center gap-3 text-sm">
                    <PlatformIcon platform={p} size={20} />
                    <span className="w-28 truncate">{PLATFORMS[p].name}</span>
                    <div className="h-2 flex-1 rounded-full bg-surface-2">
                      <div className="h-2 rounded-full bg-brand" style={{ width: `${(v.engagements / maxEng) * 100}%` }} />
                    </div>
                    <span className="w-24 text-right tabular-nums text-muted">{v.engagements.toLocaleString()} · {v.posts} posts</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="card p-5">
              <h2 className="mb-3 font-medium">Top posts</h2>
              <ul className="divide-y divide-border">
                {s.top.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <PlatformIcon platform={r.platform} size={20} />
                    <Link href={`/app/compose?post=${r.post_id}`} className="min-w-0 flex-1 truncate hover:text-brand">{r.text}</Link>
                    <span className="tabular-nums text-muted">♥ {r.likes ?? 0} · 💬 {r.comments ?? 0} · ↻ {r.shares ?? 0}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </>
  );
}
