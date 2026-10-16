import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "../AuthForms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  if (await getCurrentUser()) redirect("/app");
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Sign in</h1>
      <p className="mb-5 text-sm text-muted">Welcome back.</p>
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      <LoginForm next={next} googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)} />
    </>
  );
}
