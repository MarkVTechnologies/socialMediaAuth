import Link from "next/link";
import { consumeEmailToken } from "@/lib/auth";
import { run } from "@/lib/db";

export const metadata = { title: "Verify email" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const userId = consumeEmailToken(token, "verify");
  if (userId) run("UPDATE users SET email_verified = 1 WHERE id = ?", userId);
  return (
    <div className="text-center">
      <h1 className="mb-2 text-lg font-semibold">{userId ? "Email verified" : "Link expired"}</h1>
      <p className="mb-5 text-sm text-muted">
        {userId ? "Thanks — your email address is confirmed." : "This verification link is invalid or has already been used."}
      </p>
      <Link href="/app" className="btn-primary">Go to dashboard</Link>
    </div>
  );
}
