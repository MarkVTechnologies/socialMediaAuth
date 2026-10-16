import { NextResponse, type NextRequest } from "next/server";
import { encrypt, id } from "@/lib/crypto";
import { get, run, now } from "@/lib/db";
import { appUrl, audit } from "@/lib/notify";
import { PLATFORMS } from "@/lib/platforms";
import { adapterFor } from "@/lib/publishers";
import { getUsage } from "@/lib/workspace";
import { PLANS } from "@/lib/plans";
import type { Platform, Workspace } from "@/lib/types";

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const sp = req.nextUrl.searchParams;
  const back = (q: string) => NextResponse.redirect(`${appUrl()}/app/accounts?${q}`);

  const state = sp.get("state") ?? "";
  const row = get<{ workspace_id: string; user_id: string; platform: string; code_verifier: string; created_at: string }>(
    "SELECT * FROM oauth_states WHERE state = ?",
    state,
  );
  run("DELETE FROM oauth_states WHERE state = ? OR created_at < ?", state, new Date(Date.now() - 3600_000).toISOString());
  if (!row || row.platform !== platform || Date.now() - new Date(row.created_at).getTime() > 15 * 60000) {
    return back("error=" + encodeURIComponent("The connection request expired. Please try again."));
  }
  if (sp.get("error")) {
    return back("error=" + encodeURIComponent(sp.get("error_description") || "Connection was cancelled."));
  }

  const p = platform as Platform;
  try {
    const identities = await adapterFor(p).handleCallback(
      sp.get("code") ?? "",
      `${appUrl()}/api/connect/${p}/callback`,
      row.code_verifier,
    );
    if (identities.length === 0) {
      return back(
        "error=" +
          encodeURIComponent(
            p === "instagram"
              ? "No Instagram Professional account is linked to your Facebook Pages."
              : `No ${PLATFORMS[p].name} accounts were found.`,
          ),
      );
    }
    const ws = get<Workspace>("SELECT * FROM workspaces WHERE id = ?", row.workspace_id)!;
    let room = PLANS[ws.plan].accounts - getUsage(ws.id).accounts;
    let added = 0;
    for (const ident of identities) {
      const exists = get("SELECT 1 FROM social_accounts WHERE workspace_id = ? AND platform = ? AND external_id = ?", ws.id, p, ident.externalId);
      if (!exists && room <= 0) continue;
      run(
        `INSERT INTO social_accounts (id, workspace_id, platform, external_id, name, avatar_url, access_token_enc, refresh_token_enc,
           token_expires_at, status, connection_type, meta_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', 'official', ?, ?)
         ON CONFLICT (workspace_id, platform, external_id) DO UPDATE SET
           name = excluded.name, avatar_url = excluded.avatar_url, access_token_enc = excluded.access_token_enc,
           refresh_token_enc = COALESCE(excluded.refresh_token_enc, social_accounts.refresh_token_enc),
           token_expires_at = excluded.token_expires_at, status = 'connected', meta_json = excluded.meta_json`,
        id("acc_"), ws.id, p, ident.externalId, ident.name, ident.avatarUrl ?? null,
        encrypt(ident.accessToken), encrypt(ident.refreshToken ?? null), ident.expiresAt ?? null,
        JSON.stringify(ident.meta ?? {}), now(),
      );
      if (!exists) room--;
      added++;
    }
    audit("account.connected", { workspaceId: ws.id, actorId: row.user_id, target: p, details: { count: added } });
    const skipped = identities.length - added;
    return back(
      `connected=${added}` + (skipped ? `&error=${encodeURIComponent(`${skipped} account(s) skipped: plan limit reached.`)}` : ""),
    );
  } catch (e) {
    console.error("[connect]", p, e);
    return back("error=" + encodeURIComponent(`Could not connect ${PLATFORMS[p]?.name ?? p}: ${(e as Error).message}`));
  }
}
