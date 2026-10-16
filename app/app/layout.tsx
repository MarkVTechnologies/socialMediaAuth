import Link from "next/link";
import { Bell } from "lucide-react";
import { all, get } from "@/lib/db";
import { listWorkspaces, requireWorkspace } from "@/lib/workspace";
import { PLANS } from "@/lib/plans";
import { APP_NAME } from "@/lib/brand";
import { daysUntil, formatInZone } from "@/lib/time";
import { logout } from "../(auth)/actions";
import { markNotificationsRead, stopImpersonating, switchWorkspace } from "./shell-actions";
import { MobileNav, Nav } from "./Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireWorkspace();
  const { user, workspace, impersonating } = ctx;
  const workspaces = listWorkspaces(user.id);
  const pending = get<{ n: number }>(
    "SELECT COUNT(*) n FROM posts WHERE workspace_id = ? AND status = 'pending_approval'",
    workspace.id,
  )!.n;
  const notifications = all<{ id: string; title: string; body: string; link: string | null; level: string; read: number; created_at: string }>(
    "SELECT * FROM notifications WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 8",
    workspace.id,
  );
  const unread = notifications.filter((n) => !n.read).length;
  const trialDays =
    workspace.plan === "trial" && workspace.trial_ends_at
      ? daysUntil(workspace.trial_ends_at)
      : null;

  const switcher = (
    <form action={switchWorkspace} className="mb-4">
      <select
        name="workspace"
        defaultValue={workspace.id}
        className="field"
        aria-label="Workspace"
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <div className="mt-2 flex gap-2">
        <button className="btn-secondary flex-1 px-2 py-1 text-xs">Switch</button>
        <Link href="/onboarding?new=1" className="btn-secondary flex-1 px-2 py-1 text-xs">
          + New
        </Link>
      </div>
    </form>
  );

  return (
    <div className="min-h-screen">
      {impersonating && (
        <form action={stopImpersonating} className="print:hidden flex items-center justify-center gap-3 bg-warn px-4 py-2 text-sm text-white">
          Admin view of <b>{workspace.name}</b> — actions are audit-logged.
          <button className="underline">Exit</button>
        </form>
      )}
      <header className="print:hidden sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur">
        <MobileNav pendingApprovals={pending}>{switcher}</MobileNav>
        <Link href="/app" className="font-semibold tracking-tight">
          {APP_NAME}
        </Link>
        <span className="hidden text-sm text-muted sm:inline">/ {workspace.name}</span>
        <div className="flex-1" />
        {trialDays !== null && (
          <Link href="/app/billing" className="hidden rounded-full bg-warn-soft px-3 py-1 text-xs font-medium text-warn sm:block">
            {trialDays > 0 ? `Trial: ${trialDays} days left` : "Trial ended"} · Upgrade
          </Link>
        )}
        <details className="relative">
          <summary className="relative cursor-pointer list-none rounded-lg p-2 hover:bg-surface-2" aria-label="Notifications">
            <Bell size={18} />
            {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" />}
          </summary>
          <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-2 shadow-lg">
            {notifications.length === 0 && <p className="p-3 text-sm text-muted">No notifications yet.</p>}
            {notifications.map((n) => (
              <Link
                key={n.id}
                href={n.link ?? "/app"}
                className="block rounded-lg p-3 text-sm hover:bg-surface-2"
              >
                <p className={n.level === "error" ? "font-medium text-danger" : "font-medium"}>{n.title}</p>
                <p className="mt-0.5 line-clamp-2 text-muted">{n.body}</p>
                <p className="mt-1 text-xs text-muted">{formatInZone(n.created_at, workspace.timezone)}</p>
              </Link>
            ))}
            {unread > 0 && (
              <form action={markNotificationsRead}>
                <button className="w-full p-2 text-center text-xs text-brand">Mark all as read</button>
              </form>
            )}
          </div>
        </details>
        <details className="relative">
          <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-ink">
            {user.name.charAt(0).toUpperCase()}
          </summary>
          <div className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-border bg-surface p-2 text-sm shadow-lg">
            <p className="px-3 py-2 font-medium">{user.name}</p>
            <p className="px-3 pb-2 text-xs text-muted">{user.email}</p>
            {user.is_admin ? (
              <Link href="/admin" className="block rounded-lg px-3 py-2 hover:bg-surface-2">
                Admin back office
              </Link>
            ) : null}
            <form action={logout}>
              <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface-2">Sign out</button>
            </form>
          </div>
        </details>
      </header>
      <div className="mx-auto flex max-w-7xl">
        <aside className="print:hidden sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-border p-4 lg:block">
          {switcher}
          <Nav pendingApprovals={pending} />
          <p className="mt-6 px-3 text-xs text-muted">
            Plan: <b>{PLANS[workspace.plan].name}</b>
            <br />
            Time zone: {workspace.timezone}
          </p>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 print:p-0">{children}</main>
      </div>
    </div>
  );
}
