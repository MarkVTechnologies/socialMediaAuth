import { revalidatePath } from "next/cache";
import { get, parseJson } from "@/lib/db";
import { decide, postForApprovalToken } from "@/lib/approvals";
import { getMedia, getVariants } from "@/lib/posts";
import { formatInZone } from "@/lib/time";
import { APP_NAME } from "@/lib/brand";
import { Alert, PlatformIcon, StatusBadge } from "@/components/ui";
import type { Workspace } from "@/lib/types";

export const metadata = { title: "Review post", robots: { index: false } };

/** Client approval link — no login needed. */
async function decideAction(form: FormData) {
  "use server";
  const token = String(form.get("token"));
  const post = postForApprovalToken(token);
  if (!post || !["pending_approval", "draft"].includes(post.status)) return;
  const name = String(form.get("name") || "").trim().slice(0, 80) || "Client";
  await decide(post, `${name} (client link)`, form.get("decision") === "approve" ? "approved" : "rejected", String(form.get("comment") || "").slice(0, 1000));
  revalidatePath(`/approve/${token}`);
}

export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const post = postForApprovalToken(token);
  if (!post) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-lg font-semibold">This link has expired</h1>
        <p className="mt-2 text-sm text-muted">Ask your social media manager for a new approval link.</p>
      </div>
    );
  }
  const ws = get<Workspace>("SELECT * FROM workspaces WHERE id = ?", post.workspace_id)!;
  const variants = getVariants(post.id);
  const media = getMedia(ws.id, parseJson<string[]>(post.media_ids, []));
  const decided = Boolean(get("SELECT 1 FROM approvals WHERE post_id = ? AND approver LIKE '%(client link)'", post.id));
  const open = post.status === "pending_approval" || (post.status === "draft" && !decided);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm text-muted">{APP_NAME} · {ws.name}</p>
      <div className="mb-6 mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Review this post</h1>
        <StatusBadge status={post.status} />
      </div>
      {post.scheduled_at && <p className="mb-4 text-sm text-muted">Planned for {formatInZone(post.scheduled_at, ws.timezone)} ({ws.timezone})</p>}

      {media.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {media.map((m) =>
            m.type === "video" ? (
              <video key={m.id} src={`/media/${m.storage_key}`} controls className="h-48 rounded-lg bg-black" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={m.id} src={`/media/${m.storage_key}`} alt="" className="h-48 rounded-lg object-cover" />
            ),
          )}
        </div>
      )}

      <div className="space-y-3">
        {variants.map((v) => (
          <div key={v.id} className="card p-4">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <PlatformIcon platform={v.platform} /> {v.account_name}
            </div>
            {v.title && <p className="font-semibold">{v.title}</p>}
            <p className="whitespace-pre-wrap text-sm">{v.text}</p>
          </div>
        ))}
      </div>

      {open ? (
        <form action={decideAction} className="card mt-6 space-y-3 p-5">
          <input type="hidden" name="token" value={token} />
          <div className="grid gap-3 sm:grid-cols-2">
            <input name="name" className="field" placeholder="Your name" required />
          </div>
          <textarea name="comment" className="field" placeholder="Comments or requested changes (optional)" />
          <div className="flex gap-2">
            <button name="decision" value="reject" className="btn-danger">Request changes</button>
            <button name="decision" value="approve" className="btn-primary">Approve</button>
          </div>
        </form>
      ) : (
        <div className="mt-6">
          <Alert tone="ok">Thank you — your decision has been recorded.</Alert>
        </div>
      )}
    </div>
  );
}
