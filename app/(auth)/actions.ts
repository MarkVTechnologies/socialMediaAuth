"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { get, run, now } from "@/lib/db";
import { hashPassword, id, verifyPassword } from "@/lib/crypto";
import {
  consumeEmailToken,
  createEmailToken,
  createSession,
  destroySession,
  findUserByEmail,
} from "@/lib/auth";
import { appUrl, audit, sendEmail } from "@/lib/notify";
import { createWorkspace } from "@/lib/workspace";
import { APP_NAME } from "@/lib/brand";

export type FormState = { error?: string; message?: string } | undefined;

const SignupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name"),
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters"),
  business: z.string().trim().min(2, "Enter your business name"),
});

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  const parsed = SignupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, email, password, business } = parsed.data;
  if (findUserByEmail(email)) return { error: "An account with this email already exists. Sign in instead." };

  const userId = id("usr_");
  const isFirstUser = !get("SELECT 1 FROM users LIMIT 1");
  run(
    "INSERT INTO users (id, name, email, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    userId,
    name,
    email,
    hashPassword(password),
    isFirstUser || email === process.env.ADMIN_EMAIL?.toLowerCase() ? 1 : 0,
    now(),
  );
  createWorkspace(userId, business);
  await sendVerification(userId, email);
  await createSession(userId);
  redirect("/app");
}

async function sendVerification(userId: string, email: string) {
  const token = createEmailToken(userId, "verify", 48);
  await sendEmail(
    email,
    `Verify your ${APP_NAME} email`,
    `<p>Welcome to ${APP_NAME}! Confirm your email address:</p><p><a href="${appUrl()}/verify?token=${token}">Verify email</a></p>`,
  );
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") || "").toLowerCase().trim();
  const password = String(form.get("password") || "");
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) return { error: "Incorrect email or password." };
  await createSession(user.id);
  audit("user.login", { actorId: user.id });
  const next = String(form.get("next") || "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/app");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function requestReset(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") || "").toLowerCase().trim();
  const user = findUserByEmail(email);
  if (user) {
    const token = createEmailToken(user.id, "reset", 2);
    await sendEmail(
      email,
      `Reset your ${APP_NAME} password`,
      `<p>Reset your password (link valid for 2 hours):</p><p><a href="${appUrl()}/reset?token=${token}">Choose a new password</a></p>`,
    );
  }
  return { message: "If that email has an account, we've sent a reset link." };
}

export async function resetPassword(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") || "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  const userId = consumeEmailToken(String(form.get("token") || ""), "reset");
  if (!userId) return { error: "This reset link is invalid or has expired." };
  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password), userId);
  run("DELETE FROM sessions WHERE user_id = ?", userId);
  audit("user.password_reset", { actorId: userId });
  await createSession(userId);
  redirect("/app");
}

export async function resendVerification(userId: string, email: string) {
  await sendVerification(userId, email);
}
