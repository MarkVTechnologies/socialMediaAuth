import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SignupForm } from "../AuthForms";

export const metadata = { title: "Start free trial" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/app");
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Start your free trial</h1>
      <p className="mb-5 text-sm text-muted">14 days free. No card needed.</p>
      <SignupForm googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)} />
    </>
  );
}
