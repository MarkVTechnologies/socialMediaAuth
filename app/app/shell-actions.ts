"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, requireUser } from "@/lib/auth";
import { run } from "@/lib/db";
import { audit } from "@/lib/notify";
import { listWorkspaces, requireWorkspace, setActiveWorkspace } from "@/lib/workspace";

export async function switchWorkspace(form: FormData) {
  const user = await requireUser();
  const wsId = String(form.get("workspace"));
  if (listWorkspaces(user.id).some((w) => w.id === wsId)) await setActiveWorkspace(wsId);
  redirect("/app");
}

export async function markNotificationsRead() {
  const ctx = await requireWorkspace();
  run("UPDATE notifications SET read = 1 WHERE workspace_id = ?", ctx.workspace.id);
  revalidatePath("/app", "layout");
}

export async function stopImpersonating() {
  const session = await getSession();
  const ctx = await requireWorkspace();
  if (session) run("UPDATE sessions SET impersonating_workspace_id = NULL WHERE id = ?", session.id);
  audit("admin.impersonation_ended", { actorId: ctx.user.id, workspaceId: ctx.workspace.id });
  redirect("/admin");
}
