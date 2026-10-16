import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { get, run, now } from "./db";
import { randomToken, sha256 } from "./crypto";
import type { User } from "./types";

const SESSION_COOKIE = "sma_session";
const SESSION_DAYS = 30;

export async function createSession(userId: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  run(
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    sha256(token),
    userId,
    expires.toISOString(),
    now(),
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) run("DELETE FROM sessions WHERE id = ?", sha256(token));
  jar.delete(SESSION_COOKIE);
}

interface SessionRow {
  id: string;
  user_id: string;
  impersonating_workspace_id: string | null;
  expires_at: string;
}

export async function getSession(): Promise<SessionRow | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = get<SessionRow>("SELECT * FROM sessions WHERE id = ?", sha256(token));
  if (!session || session.expires_at < now()) return null;
  return session;
}

export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;
  return get<User>("SELECT * FROM users WHERE id = ?", session.user_id) ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!user.is_admin) redirect("/app");
  return user;
}

export function findUserByEmail(email: string) {
  return get<User>("SELECT * FROM users WHERE email = ?", email.trim().toLowerCase());
}

export function createEmailToken(userId: string, purpose: "verify" | "reset", hours: number) {
  const token = randomToken();
  run(
    "INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)",
    sha256(token),
    userId,
    purpose,
    new Date(Date.now() + hours * 3600_000).toISOString(),
  );
  return token;
}

export function consumeEmailToken(token: string, purpose: "verify" | "reset"): string | null {
  const row = get<{ user_id: string; expires_at: string; purpose: string }>(
    "SELECT * FROM email_tokens WHERE token_hash = ?",
    sha256(token),
  );
  if (!row || row.purpose !== purpose || row.expires_at < now()) return null;
  run("DELETE FROM email_tokens WHERE token_hash = ?", sha256(token));
  return row.user_id;
}
