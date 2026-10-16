import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { all, get, run, now } from "@/lib/db";
import { findUserByEmail, createEmailToken } from "@/lib/auth";
import { id } from "@/lib/crypto";
import { appUrl, audit, sendEmail } from "@/lib/notify";
import { can, requireRole, requireWorkspace, ROLE_LABELS } from "@/lib/workspace";
import { APP_NAME } from "@/lib/brand";
import { Alert, Badge, PageHeader } from "@/components/ui";
import type { Role } from "@/lib/types";

export const metadata = { title: "Team" };

const ASSIGNABLE: Role[] = ["admin", "editor", "contributor", "approver"];

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including billing",
  admin: "Manage accounts, team and settings; approve posts",
  editor: "Create and schedule posts",
  contributor: "Create drafts only — needs approval",
  approver: "Approve or reject posts",
};

async function invite(form: FormData) {
  "use server";
  const ctx = await requireRole(can.manageTeam);
  const email = String(form.get("email") || "").trim().toLowerCase();
  const role = String(form.get("role")) as Role;
  if (!email.includes("@") || !ASSIGNABLE.includes(role)) redirect("/app/team?error=Enter+a+valid+email+and+role");

  let user = findUserByEmail(email);
  let setupLink = "";
  if (!user) {
    const userId = id("usr_");
    run("INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)", userId, email.split("@")[0], email, now());
    user = findUserByEmail(email)!;
    setupLink = `${appUrl()}/reset?token=${createEmailToken(userId, "reset", 72)}`;
  }
  if (get("SELECT 1 FROM memberships WHERE user_id = ? AND workspace_id = ?", user.id, ctx.workspace.id)) {
    redirect("/app/team?error=That+person+is+already+on+the+team");
  }
  run("INSERT INTO memberships (user_id, workspace_id, role, created_at) VALUES (?, ?, ?, ?)", user.id, ctx.workspace.id, role, now());
  await sendEmail(
    email,
    `You've been added to ${ctx.workspace.name} on ${APP_NAME}`,
    `<p>${ctx.user.name} added you to <b>${ctx.workspace.name}</b> as ${ROLE_LABELS[role]}.</p>` +
      (setupLink ? `<p><a href="${setupLink}">Set your password</a> (link valid 3 days)</p>` : `<p><a href="${appUrl()}/login">Sign in</a></p>`),
  );
  audit("team.member_added", { workspaceId: ctx.workspace.id, actorId: ctx.user.id, target: user.id, details: { role } });
  revalidatePath("/app/team");
  redirect("/app/team?invited=1");
}

async function changeRole(form: FormData) {
  "use server";
  const ctx = await requireRole(can.manageTeam);
  const userId = String(form.get("user"));
  const role = String(form.get("role")) as Role;
  const target = get<{ role: Role }>("SELECT role FROM memberships WHERE user_id = ? AND workspace_id = ?", userId, ctx.workspace.id);
  if (!target || target.role === "owner" || !ASSIGNABLE.includes(role)) return;
  run("UPDATE memberships SET role = ? WHERE user_id = ? AND workspace_id = ?", role, userId, ctx.workspace.id);
  audit("team.role_changed", { workspaceId: ctx.workspace.id, actorId: ctx.user.id, target: userId, details: { from: target.role, to: role } });
  revalidatePath("/app/team");
}

async function removeMember(form: FormData) {
  "use server";
  const ctx = await requireRole(can.manageTeam);
  const userId = String(form.get("user"));
  run("DELETE FROM memberships WHERE user_id = ? AND workspace_id = ? AND role != 'owner'", userId, ctx.workspace.id);
  audit("team.member_removed", { workspaceId: ctx.workspace.id, actorId: ctx.user.id, target: userId });
  revalidatePath("/app/team");
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ error?: string; invited?: string }> }) {
  const { workspace, role, user: me } = await requireWorkspace();
  const { error, invited } = await searchParams;
  const members = all<{ id: string; name: string; email: string; role: Role }>(
    `SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ? ORDER BY m.created_at`,
    workspace.id,
  );
  const manage = can.manageTeam(role);

  return (
    <>
      <PageHeader title="Team" description="Invite colleagues and clients, each with the right level of access." />
      {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}
      {invited && <div className="mb-4"><Alert tone="ok">Invitation sent.</Alert></div>}

      <div className="card mb-6 divide-y divide-border">
        {members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">
              {m.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{m.name} {m.id === me.id && <span className="text-muted">(you)</span>}</p>
              <p className="text-sm text-muted">{m.email}</p>
            </div>
            {manage && m.role !== "owner" && m.id !== me.id ? (
              <>
                <form action={changeRole} className="flex gap-1">
                  <input type="hidden" name="user" value={m.id} />
                  <select name="role" defaultValue={m.role} className="field w-auto py-1">
                    {ASSIGNABLE.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                  <button className="btn-secondary px-3 py-1">Save</button>
                </form>
                <form action={removeMember}>
                  <input type="hidden" name="user" value={m.id} />
                  <button className="btn-danger px-3 py-1">Remove</button>
                </form>
              </>
            ) : (
              <Badge tone={m.role === "owner" ? "brand" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
            )}
          </div>
        ))}
      </div>

      {manage && (
        <form action={invite} className="card max-w-xl space-y-4 p-5">
          <h2 className="font-medium">Invite someone</h2>
          <div className="flex flex-wrap gap-2">
            <input name="email" type="email" required className="field min-w-56 flex-1" placeholder="name@company.com" />
            <select name="role" className="field w-auto" defaultValue="editor">
              {ASSIGNABLE.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <button className="btn-primary">Invite</button>
          </div>
          <ul className="space-y-1 text-sm text-muted">
            {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
              <li key={r}><b className="text-text">{ROLE_LABELS[r]}:</b> {ROLE_HELP[r]}</li>
            ))}
          </ul>
        </form>
      )}
    </>
  );
}
