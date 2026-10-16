import Link from "next/link";
import { revalidatePath } from "next/cache";
import { all, get, parseJson } from "@/lib/db";
import { can, requireRole, requireWorkspace } from "@/lib/workspace";
import { decide } from "@/lib/approvals";
import { getVariants } from "@/lib/posts";
import { formatInZone } from "@/lib/time";
import { Alert, EmptyState, PageHeader, PlatformIcon } from "@/components/ui";
import type { Post } from "@/lib/types";

export const metadata = { title: "Approvals" };

async function decideAction(form: FormData) {
  "use server";
  const ctx = await requireRole(can.approve);
  const post = get<Post>("SELECT * FROM posts WHERE id = ? AND workspace_id = ?", String(form.get("post")), ctx.workspace.id);
  if (!post || post.status !== "pending_approval") return;
  await decide(post, ctx.user.name, form.get("decision") === "approve" ? "approved" : "rejected", String(form.get("comment") || ""), ctx.user.id);
  revalidatePath("/app", "layout");
}

export default async function ApprovalsPage() {
  const { workspace, role } = await requireWorkspace();
  const posts = all<Post & { author: string }>(
    `SELECT p.*, u.name author FROM posts p JOIN users u ON u.id = p.author_id
     WHERE p.workspace_id = ? AND p.status = 'pending_approval' ORDER BY p.scheduled_at`,
    workspace.id,
  );
  const approver = can.approve(role);

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          workspace.require_approval
            ? "Posts by Contributors (and anyone without approval rights) wait here before they can publish."
            : "Posts by Contributors wait here. Turn on approval for everyone in Brand & settings."
        }
      />
      {!approver && <div className="mb-4"><Alert tone="brand">You can view pending posts. An Admin or Client Approver will review them.</Alert></div>}
      {posts.length === 0 ? (
        <EmptyState title="Nothing waiting" body="When someone submits a post for approval it will appear here." />
      ) : (
        <div className="space-y-4">
          {posts.map((p) => {
            const variants = getVariants(p.id);
            const media = parseJson<string[]>(p.media_ids, []).length;
            return (
              <div key={p.id} className="card p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted">
                    By <b className="text-text">{p.author}</b>
                    {p.scheduled_at ? ` · for ${formatInZone(p.scheduled_at, workspace.timezone)}` : ""}
                    {media ? ` · ${media} media` : ""}
                  </p>
                  <Link href={`/app/compose?post=${p.id}`} className="text-sm text-brand">Open in composer →</Link>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {variants.map((v) => (
                    <div key={v.id} className="rounded-lg bg-surface-2 p-3">
                      <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                        <PlatformIcon platform={v.platform} size={18} /> {v.account_name}
                      </div>
                      {v.title && <p className="text-sm font-semibold">{v.title}</p>}
                      <p className="line-clamp-6 whitespace-pre-wrap text-sm">{v.text}</p>
                    </div>
                  ))}
                </div>
                {approver && (
                  <form action={decideAction} className="mt-4 flex flex-wrap gap-2">
                    <input type="hidden" name="post" value={p.id} />
                    <input name="comment" className="field max-w-md flex-1" placeholder="Comment (optional)" />
                    <button name="decision" value="reject" className="btn-danger">Reject</button>
                    <button name="decision" value="approve" className="btn-primary">Approve</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
