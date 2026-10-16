import { all, run, now } from "./db";
import { id } from "./crypto";

/** Audit log of sensitive actions (connect, publish, role changes, impersonation). */
export function audit(
  action: string,
  opts: { workspaceId?: string | null; actorId?: string | null; target?: string; details?: unknown } = {},
) {
  run(
    "INSERT INTO audit_logs (id, workspace_id, actor_id, action, target, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id("al_"),
    opts.workspaceId ?? null,
    opts.actorId ?? null,
    action,
    opts.target ?? null,
    JSON.stringify(opts.details ?? {}),
    now(),
  );
}

/** In-app notification for the workspace, plus email to owners/admins when email is configured. */
export async function notify(
  workspaceId: string,
  n: { title: string; body: string; link?: string; level?: "info" | "warning" | "error" | "success"; email?: boolean },
) {
  run(
    "INSERT INTO notifications (id, workspace_id, title, body, link, level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id("nt_"),
    workspaceId,
    n.title,
    n.body,
    n.link ?? null,
    n.level ?? "info",
    now(),
  );
  if (n.email) {
    const recipients = all<{ email: string }>(
      `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? AND m.role IN ('owner','admin')`,
      workspaceId,
    );
    const link = n.link ? `${appUrl()}${n.link}` : appUrl();
    await Promise.all(
      recipients.map((r) =>
        sendEmail(r.email, n.title, `<p>${escapeHtml(n.body)}</p><p><a href="${link}">Open dashboard</a></p>`),
      ),
    );
  }
}

export function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email:dev] to=${to} subject="${subject}"\n${html.replace(/<[^>]+>/g, " ")}`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || "Postwise <noreply@example.com>", to, subject, html }),
    });
    if (!res.ok) console.error("[email] send failed", res.status, await res.text());
  } catch (e) {
    console.error("[email] send failed", e);
  }
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
