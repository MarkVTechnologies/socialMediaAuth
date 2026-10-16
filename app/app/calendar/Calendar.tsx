"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import clsx from "clsx";
import { Repeat } from "lucide-react";
import { Alert, EmptyState, PlatformIcon, StatusBadge, STATUS_TONE } from "@/components/ui";
import type { Platform } from "@/lib/types";
import { reschedulePost } from "./actions";

export interface CalendarPost {
  id: string;
  text: string;
  status: string;
  local: string; // YYYY-MM-DDTHH:mm in workspace time
  recurring: boolean;
  platforms: string[];
  urls: { platform: string; url: string }[];
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MOVABLE = new Set(["scheduled", "draft", "pending_approval", "failed"]);
const DOT: Record<string, string> = { neutral: "bg-muted", brand: "bg-brand", ok: "bg-ok", warn: "bg-warn", danger: "bg-danger" };

export function Calendar({
  view,
  startYmd,
  days,
  month,
  today,
  posts,
}: {
  view: "month" | "week" | "list";
  startYmd: string;
  days: number;
  month: number;
  today: string;
  posts: CalendarPost[];
}) {
  const [optimistic, move] = useOptimistic(posts, (state, m: { id: string; ymd: string }) =>
    state.map((p) => (p.id === m.id ? { ...p, local: m.ymd + p.local.slice(10) } : p)),
  );
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<string | null>(null);

  function drop(ymd: string, postId: string) {
    setDragOver(null);
    const post = optimistic.find((p) => p.id === postId);
    if (!post || post.local.slice(0, 10) === ymd) return;
    setError(null);
    startTransition(async () => {
      move({ id: postId, ymd });
      const r = await reschedulePost(postId, ymd);
      if (!r.ok) setError(r.error ?? "Could not reschedule");
    });
  }

  if (view === "list") {
    if (optimistic.length === 0)
      return <EmptyState title="Nothing scheduled" body="Posts you schedule in the next 60 days appear here." action={<Link href="/app/compose" className="btn-primary">Create a post</Link>} />;
    return (
      <div className="card divide-y divide-border">
        {optimistic.map((p, i) => {
          const day = p.local.slice(0, 10);
          const header = i === 0 || optimistic[i - 1].local.slice(0, 10) !== day;
          return (
            <div key={p.id}>
              {header && (
                <p className="bg-surface-2 px-4 py-1.5 text-xs font-medium text-muted">
                  {new Date(day + "T00:00:00Z").toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
                </p>
              )}
              <Link href={`/app/compose?post=${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <span className="w-12 text-sm tabular-nums text-muted">{p.local.slice(11, 16)}</span>
                <div className="flex gap-1">
                  {p.platforms.map((pl) => (
                    <PlatformIcon key={pl} platform={pl as Platform} size={20} />
                  ))}
                </div>
                <p className="min-w-0 flex-1 truncate text-sm">{p.text || "(no text)"}</p>
                {p.recurring && <Repeat size={14} className="text-muted" />}
                <StatusBadge status={p.status} />
              </Link>
            </div>
          );
        })}
      </div>
    );
  }

  const cells = Array.from({ length: days }, (_, i) => {
    const d = new Date(startYmd + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });

  return (
    <>
      {error && <div className="mb-3"><Alert tone="danger">{error}</Alert></div>}
      <div className="overflow-x-auto">
        <div className="card min-w-[640px] overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-xs font-medium text-muted">
            {DOW.map((d) => (
              <div key={d} className="px-2 py-2">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d) => {
              const ymd = d.toISOString().slice(0, 10);
              const dayPosts = optimistic.filter((p) => p.local.startsWith(ymd));
              const outside = view === "month" && d.getUTCMonth() !== month;
              return (
                <div
                  key={ymd}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(ymd);
                  }}
                  onDragLeave={() => setDragOver((s) => (s === ymd ? null : s))}
                  onDrop={(e) => drop(ymd, e.dataTransfer.getData("text/plain"))}
                  className={clsx(
                    "group border-b border-r border-border p-1.5",
                    view === "week" ? "min-h-80" : "min-h-28",
                    outside && "bg-surface-2/50",
                    dragOver === ymd && "bg-brand-soft",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={clsx(
                        "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                        ymd === today ? "bg-brand font-semibold text-brand-ink" : outside ? "text-muted" : "",
                      )}
                    >
                      {d.getUTCDate()}
                    </span>
                    {ymd >= today && (
                      <Link
                        href={`/app/compose?date=${ymd}`}
                        className="hidden h-5 w-5 items-center justify-center rounded text-muted hover:bg-surface-2 group-hover:flex"
                        aria-label="New post on this day"
                      >
                        +
                      </Link>
                    )}
                  </div>
                  <div className="space-y-1">
                    {dayPosts.map((p) => (
                      <Link
                        key={p.id}
                        href={`/app/compose?post=${p.id}`}
                        draggable={MOVABLE.has(p.status)}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", p.id)}
                        className={clsx(
                          "block rounded-md border border-border bg-surface px-1.5 py-1 text-xs hover:border-brand",
                          MOVABLE.has(p.status) && "cursor-grab",
                        )}
                        title={p.text}
                      >
                        <div className="flex items-center gap-1">
                          <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", DOT[STATUS_TONE[p.status] ?? "neutral"])} />
                          <span className="tabular-nums text-muted">{p.local.slice(11, 16)}</span>
                          <div className="flex gap-0.5">
                            {p.platforms.slice(0, 4).map((pl) => (
                              <PlatformIcon key={pl} platform={pl as Platform} size={14} />
                            ))}
                          </div>
                          {p.recurring && <Repeat size={11} className="text-muted" />}
                        </div>
                        <p className="mt-0.5 line-clamp-2">{p.text || "(no text)"}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
