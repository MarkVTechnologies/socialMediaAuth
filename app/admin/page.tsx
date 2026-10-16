import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { all, get, run } from "@/lib/db";
import { getSession, requireAdmin } from "@/lib/auth";
import { listFlags, setFlag } from "@/lib/flags";
import { audit } from "@/lib/notify";
import { queueStats } from "@/lib/scheduler";
import { PLANS, formatNaira } from "@/lib/plans";
import { PLATFORMS } from "@/lib/platforms";
import { APP_NAME } from "@/lib/brand";
import { daysAgo } from "@/lib/time";
import { Badge } from "@/components/ui";
import type { Platform, PlanId } from "@/lib/types";

export const metadata = { title: "Admin" };

async function toggleFlag(form: FormData) {
  "use server";
  const admin = await requireAdmin();
  const key = String(form.get("key"));
  const enabled = form.get("enabled") === "1";
  setFlag(key, enabled);
  audit("admin.flag_changed", { actorId: admin.id, target: key, details: { enabled } });
  revalidatePath("/admin");
}

async function impersonate(form: FormData) {
  "use server";
  const admin = await requireAdmin();
  const session = await getSession();
  const wsId = String(form.get("workspace"));
  if (!session || !get("SELECT 1 FROM workspaces WHERE id = ?", wsId)) return;
  run("UPDATE sessions SET impersonating_workspace_id = ? WHERE id = ?", wsId, session.id);
  audit("admin.impersonation_started", { actorId: admin.id, workspaceId: wsId });
  redirect("/app");
}

async function changePlan(form: FormData) {
  "use server";
  const admin = await requireAdmin();
  const wsId = String(form.get("workspace"));
  const plan = String(form.get("plan")) as PlanId;
  if (!(plan in PLANS)) return;
  run("UPDATE workspaces SET plan = ?, plan_status = 'active' WHERE id = ?", plan, wsId);
  audit("admin.plan_changed", { actorId: admin.id, workspaceId: wsId, details: { plan } });
  revalidatePath("/admin");
}

export default async function AdminPage() {
  await requireAdmin();
  const workspaces = all<{
    id: string; name: string; plan: PlanId; plan_status: string; created_at: string; owner: string; accounts: number; posts: number;
  }>(
    `SELECT w.id, w.name, w.plan, w.plan_status, w.created_at, u.email owner,
       (SELECT COUNT(*) FROM social_accounts a WHERE a.workspace_id = w.id) accounts,
       (SELECT COUNT(*) FROM posts p WHERE p.workspace_id = w.id) posts
     FROM workspaces w JOIN users u ON u.id = w.owner_id ORDER BY w.created_at DESC LIMIT 200`,
  );
  const mrr = workspaces.filter((w) => w.plan_status === "active").reduce((n, w) => n + PLANS[w.plan].priceNgn, 0);
  const q = queueStats();
  const platformRows = new Map<string, { published: number; failed: number }>();
  for (const r of q.byPlatform) {
    const e = platformRows.get(r.platform) ?? { published: 0, failed: 0 };
    if (r.status === "published") e.published = r.n;
    else e.failed = r.n;
    platformRows.set(r.platform, e);
  }
  const recentFailures = all<{ last_error: string; created_at: string }>(
    "SELECT last_error, created_at FROM jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10",
  );
  const users = get<{ n: number }>("SELECT COUNT(*) n FROM users")!.n;
  const ai = get<{ n: number; i: number | null; o: number | null }>(
    "SELECT COUNT(*) n, SUM(input_tokens) i, SUM(output_tokens) o FROM ai_generations WHERE created_at >= ?",
    daysAgo(30),
  )!;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{APP_NAME} back office</h1>
        <Link href="/app" className="btn-secondary">Back to app</Link>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Workspaces", workspaces.length],
          ["Users", users],
          ["MRR (list price)", formatNaira(mrr)],
          ["Overdue jobs", q.overdue],
          ["AI calls (30d)", `${ai.n} · ${(((ai.i ?? 0) + (ai.o ?? 0)) / 1000).toFixed(0)}k tok`],
        ].map(([k, v]) => (
          <div key={k} className="card p-4">
            <p className="text-xs text-muted">{k}</p>
            <p className={`mt-1 text-xl font-semibold ${k === "Overdue jobs" && Number(v) > 0 ? "text-danger" : ""}`}>{v}</p>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 font-medium">Publishing health by platform</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr><th className="py-1">Platform</th><th className="text-right">Published</th><th className="text-right">Failed</th><th className="text-right">Failure rate</th></tr>
            </thead>
            <tbody>
              {[...platformRows.entries()].map(([p, v]) => {
                const rate = v.failed / Math.max(1, v.published + v.failed);
                return (
                  <tr key={p} className="border-t border-border">
                    <td className="py-1.5">{PLATFORMS[p as Platform]?.name ?? p}</td>
                    <td className="text-right tabular-nums">{v.published}</td>
                    <td className="text-right tabular-nums">{v.failed}</td>
                    <td className={`text-right tabular-nums ${rate > 0.05 ? "text-danger" : ""}`}>{(rate * 100).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">Queue: {q.byStatus.map((s) => `${s.status} ${s.n}`).join(" · ") || "empty"}</p>
          {recentFailures.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-danger">
              {recentFailures.map((f, i) => <li key={i} className="truncate">{f.last_error}</li>)}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 font-medium">Feature flags</h2>
          <ul className="space-y-3">
            {listFlags().map((f) => (
              <li key={f.key} className="flex items-start gap-3">
                <form action={toggleFlag}>
                  <input type="hidden" name="key" value={f.key} />
                  <input type="hidden" name="enabled" value={f.enabled ? "0" : "1"} />
                  <button className={f.enabled ? "btn-primary px-3 py-1" : "btn-secondary px-3 py-1"}>{f.enabled ? "On" : "Off"}</button>
                </form>
                <div>
                  <p className="font-mono text-sm">{f.key}</p>
                  <p className="text-xs text-muted">{f.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card overflow-x-auto p-5">
        <h2 className="mb-3 font-medium">Customers</h2>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-muted">
            <tr><th className="py-1">Workspace</th><th>Owner</th><th>Plan</th><th className="text-right">Accounts</th><th className="text-right">Posts</th><th></th></tr>
          </thead>
          <tbody>
            {workspaces.map((w) => (
              <tr key={w.id} className="border-t border-border">
                <td className="py-2">{w.name}</td>
                <td className="text-muted">{w.owner}</td>
                <td>
                  <form action={changePlan} className="flex items-center gap-1">
                    <input type="hidden" name="workspace" value={w.id} />
                    <select name="plan" defaultValue={w.plan} className="field w-auto py-1 text-xs">
                      {Object.values(PLANS).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button className="text-xs text-brand">Set</button>
                    {w.plan_status !== "active" && <Badge tone="danger">{w.plan_status}</Badge>}
                  </form>
                </td>
                <td className="text-right tabular-nums">{w.accounts}</td>
                <td className="text-right tabular-nums">{w.posts}</td>
                <td className="text-right">
                  <form action={impersonate}>
                    <input type="hidden" name="workspace" value={w.id} />
                    <button className="text-xs text-brand">View as</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
