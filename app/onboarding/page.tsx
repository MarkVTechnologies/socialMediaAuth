import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createWorkspace, listWorkspaces, setActiveWorkspace } from "@/lib/workspace";
import { APP_NAME } from "@/lib/brand";

export const metadata = { title: "Create workspace" };

async function create(form: FormData) {
  "use server";
  const user = await requireUser();
  const name = String(form.get("name") || "").trim();
  if (name.length < 2) return;
  const wsId = createWorkspace(user.id, name);
  await setActiveWorkspace(wsId);
  redirect("/app");
}

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();
  const { new: forceNew } = await searchParams;
  if (!forceNew && listWorkspaces(user.id).length > 0) redirect("/app");
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form action={create} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <p className="text-sm text-muted">{APP_NAME}</p>
          <h1 className="text-lg font-semibold">Create a workspace</h1>
          <p className="mt-1 text-sm text-muted">A workspace holds one business&apos;s accounts, posts and brand profile.</p>
        </div>
        <div>
          <label className="label" htmlFor="name">Business name</label>
          <input className="field" id="name" name="name" required minLength={2} />
        </div>
        <button className="btn-primary w-full">Continue</button>
      </form>
    </div>
  );
}
