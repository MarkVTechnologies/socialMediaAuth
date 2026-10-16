import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { all, get, run, now, parseJson, tx } from "./db";
import { id } from "./crypto";
import { getSession, requireUser } from "./auth";
import { PLANS, TRIAL_DAYS } from "./plans";
import { monthKey } from "./time";
import type { BrandProfile, Role, User, Workspace } from "./types";

const WS_COOKIE = "sma_ws";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  contributor: "Contributor",
  approver: "Client Approver",
};

const RANK: Record<Role, number> = { approver: 0, contributor: 1, editor: 2, admin: 3, owner: 4 };

export const can = {
  createDraft: (r: Role) => RANK[r] >= RANK.contributor,
  schedule: (r: Role) => RANK[r] >= RANK.editor,
  approve: (r: Role) => r === "approver" || RANK[r] >= RANK.admin,
  manageAccounts: (r: Role) => RANK[r] >= RANK.admin,
  manageTeam: (r: Role) => RANK[r] >= RANK.admin,
  manageBilling: (r: Role) => r === "owner",
};

export function createWorkspace(ownerId: string, name: string): string {
  const wsId = id("ws_");
  tx(() => {
    run(
      `INSERT INTO workspaces (id, name, owner_id, plan, timezone, brand_json, trial_ends_at, created_at)
       VALUES (?, ?, ?, 'trial', 'Africa/Lagos', ?, ?, ?)`,
      wsId,
      name,
      ownerId,
      JSON.stringify({ businessName: name, tone: "friendly", languages: ["en-NG"] } satisfies BrandProfile),
      new Date(Date.now() + TRIAL_DAYS * 86400_000).toISOString(),
      now(),
    );
    run(
      "INSERT INTO memberships (user_id, workspace_id, role, created_at) VALUES (?, ?, 'owner', ?)",
      ownerId,
      wsId,
      now(),
    );
  });
  return wsId;
}

export function listWorkspaces(userId: string) {
  return all<Workspace & { role: Role }>(
    `SELECT w.*, m.role FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
     WHERE m.user_id = ? ORDER BY w.created_at`,
    userId,
  );
}

export interface WorkspaceContext {
  user: User;
  workspace: Workspace;
  role: Role;
  brand: BrandProfile;
  impersonating: boolean;
}

/** Resolve the active workspace for the signed-in user (or redirect). */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const user = await requireUser();
  const session = await getSession();

  if (session?.impersonating_workspace_id && user.is_admin) {
    const ws = get<Workspace>("SELECT * FROM workspaces WHERE id = ?", session.impersonating_workspace_id);
    if (ws) return { user, workspace: ws, role: "admin", brand: parseJson(ws.brand_json, {}), impersonating: true };
  }

  const jar = await cookies();
  const wanted = jar.get(WS_COOKIE)?.value;
  const list = listWorkspaces(user.id);
  if (list.length === 0) redirect("/onboarding");
  const ws = list.find((w) => w.id === wanted) ?? list[0];
  const { role, ...workspace } = ws;
  return { user, workspace, role, brand: parseJson(workspace.brand_json, {}), impersonating: false };
}

export async function requireRole(check: (r: Role) => boolean) {
  const ctx = await requireWorkspace();
  if (!check(ctx.role)) throw new Error("You do not have permission to do that.");
  return ctx;
}

export async function setActiveWorkspace(workspaceId: string) {
  const jar = await cookies();
  jar.set(WS_COOKIE, workspaceId, { httpOnly: true, sameSite: "lax", path: "/" });
}

// ---- Plan limits and usage ----

export function getUsage(workspaceId: string) {
  const row = get<{ posts: number; ai_optimisations: number }>(
    "SELECT posts, ai_optimisations FROM usage_counters WHERE workspace_id = ? AND month = ?",
    workspaceId,
    monthKey(),
  );
  const accounts = get<{ n: number }>(
    "SELECT COUNT(*) n FROM social_accounts WHERE workspace_id = ?",
    workspaceId,
  )!.n;
  const storage = get<{ n: number | null }>(
    "SELECT SUM(size) n FROM media_assets WHERE workspace_id = ?",
    workspaceId,
  )!.n;
  return {
    posts: row?.posts ?? 0,
    ai: row?.ai_optimisations ?? 0,
    accounts,
    storageBytes: storage ?? 0,
  };
}

export function incrementUsage(workspaceId: string, field: "posts" | "ai_optimisations", by = 1) {
  run(
    `INSERT INTO usage_counters (workspace_id, month, ${field}) VALUES (?, ?, ?)
     ON CONFLICT (workspace_id, month) DO UPDATE SET ${field} = ${field} + excluded.${field}`,
    workspaceId,
    monthKey(),
    by,
  );
}

export type LimitKind = "accounts" | "posts" | "ai" | "storage";

/** Returns an error message if the workspace is over the limit, otherwise null. */
export function checkLimit(ws: Workspace, kind: LimitKind, adding = 1): string | null {
  const plan = PLANS[ws.plan];
  if (ws.plan === "trial" && ws.trial_ends_at && ws.trial_ends_at < now()) {
    return "Your free trial has ended. Choose a plan to keep scheduling.";
  }
  if (ws.plan_status !== "active") return "Your subscription payment is overdue. Update billing to continue.";
  const u = getUsage(ws.id);
  switch (kind) {
    case "accounts":
      return u.accounts + adding > plan.accounts
        ? `Your ${plan.name} plan allows ${plan.accounts} connected accounts.`
        : null;
    case "posts":
      return u.posts + adding > plan.postsPerMonth
        ? `Your ${plan.name} plan allows ${plan.postsPerMonth} scheduled posts per month.`
        : null;
    case "ai":
      return u.ai + adding > plan.aiPerMonth
        ? `You've used all ${plan.aiPerMonth} AI optimisations for this month.`
        : null;
    case "storage":
      return u.storageBytes + adding > plan.storageGb * 1024 ** 3
        ? `Your ${plan.name} plan includes ${plan.storageGb} GB of media storage.`
        : null;
  }
}
