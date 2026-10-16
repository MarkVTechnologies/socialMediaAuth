import Link from "next/link";
import { all } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";
import { utcToZonedLocal, zonedLocalToUtc } from "@/lib/time";
import { PageHeader } from "@/components/ui";
import { Calendar, type CalendarPost } from "./Calendar";

export const metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const { workspace } = await requireWorkspace();
  const sp = await searchParams;
  const view = (["month", "week", "list"].includes(sp.view ?? "") ? sp.view : "month") as "month" | "week" | "list";
  const todayLocal = utcToZonedLocal(new Date().toISOString(), workspace.timezone).slice(0, 10);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayLocal;

  // Visible range in local dates
  const a = new Date(anchor + "T00:00:00Z");
  let start: Date, end: Date;
  if (view === "week") {
    start = new Date(a);
    start.setUTCDate(a.getUTCDate() - ((a.getUTCDay() + 6) % 7)); // Monday
    end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 7);
  } else if (view === "month") {
    const first = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
    start = new Date(first);
    start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
    end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 42);
  } else {
    start = new Date(todayLocal + "T00:00:00Z");
    end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 60);
  }
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const fromUtc = zonedLocalToUtc(`${ymd(start)}T00:00`, workspace.timezone).toISOString();
  const toUtc = zonedLocalToUtc(`${ymd(end)}T00:00`, workspace.timezone).toISOString();

  const rows = all<{
    id: string;
    master_text: string;
    status: string;
    scheduled_at: string;
    recurrence: string | null;
    platforms: string | null;
    urls: string | null;
  }>(
    `SELECT p.id, p.master_text, p.status, COALESCE(p.scheduled_at, MAX(v.published_at)) AS scheduled_at, p.recurrence,
            GROUP_CONCAT(v.platform) platforms,
            GROUP_CONCAT(CASE WHEN v.published_url IS NOT NULL THEN v.platform || '|' || v.published_url END) urls
     FROM posts p LEFT JOIN post_variants v ON v.post_id = p.id
     WHERE p.workspace_id = ? GROUP BY p.id
     HAVING scheduled_at >= ? AND scheduled_at < ? ORDER BY scheduled_at`,
    workspace.id,
    fromUtc,
    toUtc,
  );
  const posts: CalendarPost[] = rows.map((r) => ({
    id: r.id,
    text: r.master_text,
    status: r.status,
    local: utcToZonedLocal(r.scheduled_at, workspace.timezone),
    recurring: Boolean(r.recurrence),
    platforms: [...new Set((r.platforms ?? "").split(",").filter(Boolean))],
    urls: (r.urls ?? "").split(",").filter(Boolean).map((u) => {
      const [platform, ...rest] = u.split("|");
      return { platform, url: rest.join("|") };
    }),
  }));

  const shift = (days: number, months = 0) => {
    const d = new Date(a);
    d.setUTCMonth(d.getUTCMonth() + months);
    d.setUTCDate(d.getUTCDate() + days);
    return ymd(d);
  };
  const prev = view === "month" ? shift(0, -1) : shift(-7);
  const next = view === "month" ? shift(0, 1) : shift(7);
  const title =
    view === "month"
      ? a.toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" })
      : view === "week"
        ? `Week of ${start.toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: "UTC" })}`
        : "Next 60 days";

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`All times in ${workspace.timezone}. Drag a post to another day to reschedule.`}
        actions={<Link href="/app/compose" className="btn-primary">New post</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border bg-surface text-sm">
          {(["month", "week", "list"] as const).map((v) => (
            <Link
              key={v}
              href={`/app/calendar?view=${v}&date=${anchor}`}
              className={`px-3 py-1.5 capitalize ${view === v ? "bg-brand-soft font-medium text-brand" : ""}`}
            >
              {v}
            </Link>
          ))}
        </div>
        {view !== "list" && (
          <>
            <Link href={`/app/calendar?view=${view}&date=${prev}`} className="btn-secondary px-3 py-1.5">←</Link>
            <Link href={`/app/calendar?view=${view}&date=${todayLocal}`} className="btn-secondary px-3 py-1.5">Today</Link>
            <Link href={`/app/calendar?view=${view}&date=${next}`} className="btn-secondary px-3 py-1.5">→</Link>
          </>
        )}
        <h2 className="ml-2 font-medium">{title}</h2>
      </div>
      <Calendar
        view={view}
        startYmd={ymd(start)}
        days={view === "week" ? 7 : view === "month" ? 42 : 0}
        month={a.getUTCMonth()}
        today={todayLocal}
        posts={posts}
      />
    </>
  );
}
