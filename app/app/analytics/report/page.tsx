import { loadMetrics, summarise } from "@/lib/analytics";
import { requireWorkspace } from "@/lib/workspace";
import { PLATFORMS } from "@/lib/platforms";
import { APP_NAME } from "@/lib/brand";
import { formatInZone } from "@/lib/time";
import { PrintButton } from "./PrintButton";

export const metadata = { title: "Monthly report" };

/** Print-friendly monthly report; "Save as PDF" from the browser print dialog. */
export default async function ReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { workspace } = await requireWorkspace();
  const { month } = await searchParams;
  const m = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : new Date().toISOString().slice(0, 7);
  const start = new Date(`${m}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const rows = loadMetrics(workspace.id, start.toISOString()).filter((r) => r.published_at < end.toISOString());
  const s = summarise(rows);
  const label = start.toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="mx-auto max-w-3xl bg-surface p-8 print:max-w-none print:p-0">
      <div className="mb-6 flex items-start justify-between print:hidden">
        <form className="flex gap-2">
          <input type="month" name="month" defaultValue={m} className="field w-auto" />
          <button className="btn-secondary">Show</button>
        </form>
        <PrintButton />
      </div>
      <p className="text-sm text-muted">{APP_NAME} social media report</p>
      <h1 className="text-3xl font-semibold">{workspace.name}</h1>
      <p className="mb-8 text-muted">{label}</p>

      <div className="mb-8 grid grid-cols-4 gap-4">
        {[
          ["Posts", s.posts],
          ["Views", s.views],
          ["Engagements", s.engagements],
          ["Eng. rate", s.rate === null ? "—" : `${s.rate.toFixed(1)}%`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted">{k}</p>
            <p className="text-xl font-semibold tabular-nums">{typeof v === "number" ? v.toLocaleString() : v}</p>
          </div>
        ))}
      </div>

      <h2 className="mb-2 font-medium">By platform</h2>
      <table className="mb-8 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2">Platform</th>
            <th className="py-2 text-right">Posts</th>
            <th className="py-2 text-right">Views</th>
            <th className="py-2 text-right">Engagements</th>
          </tr>
        </thead>
        <tbody>
          {[...s.byPlatform.entries()].map(([p, v]) => (
            <tr key={p} className="border-b border-border">
              <td className="py-2">{PLATFORMS[p].name}</td>
              <td className="py-2 text-right tabular-nums">{v.posts}</td>
              <td className="py-2 text-right tabular-nums">{v.views.toLocaleString()}</td>
              <td className="py-2 text-right tabular-nums">{v.engagements.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-2 font-medium">All posts</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-2">Date</th>
            <th className="py-2">Platform</th>
            <th className="py-2">Post</th>
            <th className="py-2 text-right">Likes</th>
            <th className="py-2 text-right">Comments</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border align-top">
              <td className="whitespace-nowrap py-2 pr-2">{formatInZone(r.published_at, workspace.timezone, { dateStyle: "short", timeStyle: undefined })}</td>
              <td className="py-2 pr-2">{PLATFORMS[r.platform].name}</td>
              <td className="py-2 pr-2">{r.text.slice(0, 90)}{r.text.length > 90 ? "…" : ""}</td>
              <td className="py-2 text-right tabular-nums">{r.likes ?? "—"}</td>
              <td className="py-2 text-right tabular-nums">{r.comments ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="py-6 text-center text-sm text-muted">No posts were published this month.</p>}
    </div>
  );
}
