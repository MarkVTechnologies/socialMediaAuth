"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, requestReset, resetPassword, signup, type FormState } from "./actions";
import { Alert } from "@/components/ui";

function Feedback({ state }: { state: FormState }) {
  if (state?.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state?.message) return <Alert tone="ok">{state.message}</Alert>;
  return null;
}

function GoogleButton() {
  return (
    <>
      <a href="/api/auth/google" className="btn-secondary w-full">
        Continue with Google
      </a>
      <div className="flex items-center gap-3 text-xs text-muted">
        <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}

export function LoginForm({ next, googleEnabled }: { next?: string; googleEnabled: boolean }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      {googleEnabled && <GoogleButton />}
      <Feedback state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="field" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <div className="flex justify-between">
          <label className="label" htmlFor="password">Password</label>
          <Link href="/forgot" className="text-sm text-brand">Forgot?</Link>
        </div>
        <input className="field" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      <p className="text-center text-sm text-muted">
        New here? <Link href="/signup" className="text-brand">Start your free 14-day trial</Link>
      </p>
    </form>
  );
}

export function SignupForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [state, action, pending] = useActionState(signup, undefined);
  return (
    <form action={action} className="space-y-4">
      {googleEnabled && <GoogleButton />}
      <Feedback state={state} />
      <div>
        <label className="label" htmlFor="name">Your name</label>
        <input className="field" id="name" name="name" autoComplete="name" required />
      </div>
      <div>
        <label className="label" htmlFor="business">Business name</label>
        <input className="field" id="business" name="business" placeholder="e.g. Adaeze Homes" required />
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="field" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input className="field" id="password" name="password" type="password" minLength={8} autoComplete="new-password" required />
      </div>
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Creating account…" : "Create account"}</button>
      <p className="text-center text-xs text-muted">
        By signing up you agree to our <Link href="/terms" className="underline">Terms</Link> and{" "}
        <Link href="/privacy" className="underline">Privacy Policy</Link>.
      </p>
      <p className="text-center text-sm text-muted">
        Already have an account? <Link href="/login" className="text-brand">Sign in</Link>
      </p>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestReset, undefined);
  return (
    <form action={action} className="space-y-4">
      <Feedback state={state} />
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="field" id="email" name="email" type="email" required />
      </div>
      <button className="btn-primary w-full" disabled={pending}>Send reset link</button>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, undefined);
  return (
    <form action={action} className="space-y-4">
      <Feedback state={state} />
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="label" htmlFor="password">New password</label>
        <input className="field" id="password" name="password" type="password" minLength={8} required />
      </div>
      <button className="btn-primary w-full" disabled={pending}>Set new password</button>
    </form>
  );
}
