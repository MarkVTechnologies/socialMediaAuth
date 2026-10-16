import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomToken } from "@/lib/crypto";
import { appUrl } from "@/lib/notify";

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(`${appUrl()}/login?error=Google+sign-in+is+not+configured`);
  const state = randomToken(16);
  (await cookies()).set("sma_gstate", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", `${appUrl()}/api/auth/google/callback`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "select_account");
  return NextResponse.redirect(u.toString());
}
