import { NextResponse, type NextRequest } from "next/server";
import { pkcePair, randomToken } from "@/lib/crypto";
import { run, now } from "@/lib/db";
import { appUrl } from "@/lib/notify";
import { PLATFORMS } from "@/lib/platforms";
import { adapterFor, isConfigured } from "@/lib/publishers";
import { can, checkLimit, requireWorkspace } from "@/lib/workspace";
import type { Platform } from "@/lib/types";

/** Starts the official OAuth flow for a platform. We never ask for passwords. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const back = (msg: string) => NextResponse.redirect(`${appUrl()}/app/accounts?error=${encodeURIComponent(msg)}`);
  if (!(platform in PLATFORMS) || platform === "whatsapp_status") return back("Unknown platform");
  const p = platform as Platform;

  const ctx = await requireWorkspace();
  if (!can.manageAccounts(ctx.role)) return back("Only admins can connect accounts.");
  const limit = checkLimit(ctx.workspace, "accounts");
  if (limit) return back(limit);
  if (!isConfigured(p)) return back(`${PLATFORMS[p].name} app credentials are not configured on the server yet.`);

  const state = randomToken(24);
  const { verifier, challenge } = pkcePair();
  run(
    "INSERT INTO oauth_states (state, workspace_id, user_id, platform, code_verifier, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    state,
    ctx.workspace.id,
    ctx.user.id,
    p,
    verifier,
    now(),
  );
  const url = adapterFor(p).authorizeUrl({
    state,
    redirectUri: `${appUrl()}/api/connect/${p}/callback`,
    codeChallenge: challenge,
  });
  return NextResponse.redirect(url);
}
