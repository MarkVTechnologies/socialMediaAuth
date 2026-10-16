"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { get, run, now } from "@/lib/db";
import { decrypt, encrypt, id } from "@/lib/crypto";
import { audit } from "@/lib/notify";
import { flagEnabled } from "@/lib/flags";
import { PLATFORMS } from "@/lib/platforms";
import { adapterForAccount } from "@/lib/publishers";
import { verifyGatewayToken } from "@/lib/publishers/whatsapp";
import { can, checkLimit, requireRole } from "@/lib/workspace";
import type { Platform, SocialAccount } from "@/lib/types";

const back = (q: string) => redirect(`/app/accounts?${q}`);

export async function connectDemo(form: FormData) {
  const ctx = await requireRole(can.manageAccounts);
  if (!flagEnabled("demo_connections")) back("error=Demo+accounts+are+disabled");
  const platform = String(form.get("platform")) as Platform;
  if (!(platform in PLATFORMS)) back("error=Unknown+platform");
  const limit = checkLimit(ctx.workspace, "accounts");
  if (limit) back("error=" + encodeURIComponent(limit));
  const n = get<{ n: number }>("SELECT COUNT(*) n FROM social_accounts WHERE workspace_id = ? AND platform = ?", ctx.workspace.id, platform)!.n;
  const handle = `${ctx.workspace.name}${n ? ` ${n + 1}` : ""}`;
  run(
    `INSERT INTO social_accounts (id, workspace_id, platform, external_id, name, status, connection_type, created_at)
     VALUES (?, ?, ?, ?, ?, 'connected', 'demo', ?)`,
    id("acc_"), ctx.workspace.id, platform, `demo-${id()}`, platform === "instagram" ? `@${handle.toLowerCase().replace(/\s+/g, "")}` : handle, now(),
  );
  audit("account.connected", { workspaceId: ctx.workspace.id, actorId: ctx.user.id, target: platform, details: { demo: true } });
  back("connected=1");
}

export async function connectWhatsAppStatus(form: FormData) {
  const ctx = await requireRole(can.manageAccounts);
  if (!flagEnabled("whatsapp_status")) back("error=WhatsApp+Status+autopost+is+not+enabled+yet");
  if (form.get("accept_risk") !== "on") back("error=" + encodeURIComponent("Please read and accept the risk notice first."));
  const token = String(form.get("token") || "").trim();
  if (!token) back("error=Paste+your+gateway+token");
  const limit = checkLimit(ctx.workspace, "accounts");
  if (limit) back("error=" + encodeURIComponent(limit));
  let identity;
  try {
    identity = await verifyGatewayToken(token);
  } catch (e) {
    back("error=" + encodeURIComponent(`Could not verify the gateway token: ${(e as Error).message}`));
  }
  run(
    `INSERT INTO social_accounts (id, workspace_id, platform, external_id, name, access_token_enc, status, connection_type, meta_json, created_at)
     VALUES (?, ?, 'whatsapp_status', ?, ?, ?, 'connected', 'unofficial', ?, ?)
     ON CONFLICT (workspace_id, platform, external_id) DO UPDATE SET access_token_enc = excluded.access_token_enc, status = 'connected'`,
    id("acc_"), ctx.workspace.id, identity!.externalId, identity!.name, encrypt(token),
    JSON.stringify({ riskAcceptedAt: now(), riskAcceptedBy: ctx.user.id }), now(),
  );
  audit("account.connected", {
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    target: "whatsapp_status",
    details: { unofficial: true, riskAccepted: true },
  });
  back("connected=1");
}

/** Disconnect removes stored tokens and the account (PRD §8.3 data deletion). */
export async function disconnectAccount(form: FormData) {
  const ctx = await requireRole(can.manageAccounts);
  const account = get<SocialAccount>(
    "SELECT * FROM social_accounts WHERE id = ? AND workspace_id = ?",
    String(form.get("id")),
    ctx.workspace.id,
  );
  if (!account) return;
  await adapterForAccount(account).disconnect?.(account, decrypt(account.access_token_enc)).catch(() => undefined);
  run("DELETE FROM jobs WHERE variant_id IN (SELECT id FROM post_variants WHERE social_account_id = ?) AND status = 'queued'", account.id);
  run("DELETE FROM social_accounts WHERE id = ?", account.id);
  audit("account.disconnected", { workspaceId: ctx.workspace.id, actorId: ctx.user.id, target: account.platform, details: { name: account.name } });
  revalidatePath("/app/accounts");
}
