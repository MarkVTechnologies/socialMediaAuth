import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createSession, findUserByEmail } from "@/lib/auth";
import { id } from "@/lib/crypto";
import { get, run, now } from "@/lib/db";
import { appUrl } from "@/lib/notify";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("sma_gstate")?.value;
  jar.delete("sma_gstate");
  const fail = (msg: string) => NextResponse.redirect(`${appUrl()}/login?error=${encodeURIComponent(msg)}`);
  if (!code || !state || state !== expected) return fail("Google sign-in failed. Please try again.");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${appUrl()}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail("Google sign-in failed.");
  const tok = (await tokenRes.json()) as { access_token: string };
  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  });
  const info = (await infoRes.json()) as { email?: string; email_verified?: boolean; name?: string };
  if (!info.email || !info.email_verified) return fail("Your Google email is not verified.");

  let user = findUserByEmail(info.email);
  let isNew = false;
  if (!user) {
    const userId = id("usr_");
    const isFirstUser = !get("SELECT 1 FROM users LIMIT 1");
    run(
      "INSERT INTO users (id, name, email, auth_provider, email_verified, is_admin, created_at) VALUES (?, ?, ?, 'google', 1, ?, ?)",
      userId,
      info.name || info.email.split("@")[0],
      info.email.toLowerCase(),
      isFirstUser ? 1 : 0,
      now(),
    );
    user = findUserByEmail(info.email)!;
    isNew = true;
  } else if (!user.email_verified) {
    run("UPDATE users SET email_verified = 1 WHERE id = ?", user.id);
  }
  await createSession(user.id);
  return NextResponse.redirect(`${appUrl()}${isNew ? "/onboarding" : "/app"}`);
}
