"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import {
  BarChart3,
  CalendarDays,
  CheckSquare,
  CreditCard,
  Image as ImageIcon,
  LayoutDashboard,
  Link2,
  ListChecks,
  PenSquare,
  Settings,
  Users,
} from "lucide-react";

const ITEMS = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/app/compose", label: "Compose", icon: PenSquare },
  { href: "/app/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/app/posts", label: "Posts", icon: ListChecks },
  { href: "/app/approvals", label: "Approvals", icon: CheckSquare },
  { href: "/app/media", label: "Media library", icon: ImageIcon },
  { href: "/app/accounts", label: "Accounts", icon: Link2 },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/app/team", label: "Team", icon: Users },
  { href: "/app/settings", label: "Brand & settings", icon: Settings },
  { href: "/app/billing", label: "Billing", icon: CreditCard },
];

export function Nav({ pendingApprovals, onNavigate }: { pendingApprovals: number; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="space-y-0.5">
      {ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? path === href : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={clsx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
              active ? "bg-brand-soft font-medium text-brand" : "text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            <Icon size={17} />
            <span className="flex-1">{label}</span>
            {href === "/app/approvals" && pendingApprovals > 0 && (
              <span className="rounded-full bg-warn px-1.5 text-xs font-semibold text-white">{pendingApprovals}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav({ pendingApprovals, children }: { pendingApprovals: number; children: React.ReactNode }) {
  return (
    <details className="group lg:hidden">
      <summary className="btn-secondary cursor-pointer list-none px-3">Menu</summary>
      <div className="absolute inset-x-0 top-14 z-30 border-b border-border bg-surface p-3 shadow-lg">
        {children}
        <Nav pendingApprovals={pendingApprovals} />
      </div>
    </details>
  );
}
