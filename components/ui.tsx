import clsx from "clsx";
import { PLATFORMS } from "@/lib/platforms";
import type { Platform } from "@/lib/types";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  neutral: "bg-surface-2 text-muted",
  brand: "bg-brand-soft text-brand",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", TONES[tone])}>{children}</span>;
}

export const STATUS_TONE: Record<string, keyof typeof TONES> = {
  draft: "neutral",
  pending_approval: "warn",
  scheduled: "brand",
  publishing: "brand",
  published: "ok",
  partially_published: "warn",
  failed: "danger",
  connected: "ok",
  expiring: "warn",
  disconnected: "danger",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

const SHORT: Record<Platform, string> = {
  facebook: "f",
  instagram: "IG",
  linkedin: "in",
  youtube: "▶",
  tiktok: "TT",
  whatsapp_status: "WA",
};

export function PlatformIcon({ platform, size = 24 }: { platform: Platform; size?: number }) {
  return (
    <span
      title={PLATFORMS[platform].name}
      className="inline-flex shrink-0 items-center justify-center rounded-md font-bold text-white"
      style={{ background: PLATFORMS[platform].color, width: size, height: size, fontSize: size * 0.42 }}
    >
      {SHORT[platform]}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "warn", children }: { tone?: "warn" | "danger" | "ok" | "brand"; children: React.ReactNode }) {
  const cls = {
    warn: "border-warn/30 bg-warn-soft text-warn",
    danger: "border-danger/30 bg-danger-soft text-danger",
    ok: "border-ok/30 bg-ok-soft text-ok",
    brand: "border-brand/30 bg-brand-soft text-brand",
  }[tone];
  return <div className={clsx("rounded-lg border px-4 py-3 text-sm", cls)}>{children}</div>;
}

export function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit === Infinity ? 0 : Math.min(100, (used / limit) * 100);
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-medium tabular-nums">
          {used.toLocaleString()} / {limit === Infinity ? "Unlimited" : limit.toLocaleString()}
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-2">
        <div className={clsx("h-2 rounded-full", pct > 90 ? "bg-danger" : "bg-brand")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
