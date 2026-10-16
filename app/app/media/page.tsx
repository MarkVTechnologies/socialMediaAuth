import { revalidatePath } from "next/cache";
import { all, get, run } from "@/lib/db";
import { can, getUsage, requireRole, requireWorkspace } from "@/lib/workspace";
import { deleteObject, formatBytes } from "@/lib/media";
import { PLANS } from "@/lib/plans";
import { EmptyState, Meter, PageHeader } from "@/components/ui";
import { audit } from "@/lib/notify";
import { Uploader } from "./Uploader";
import type { MediaAsset } from "@/lib/types";

export const metadata = { title: "Media library" };

async function deleteMedia(form: FormData) {
  "use server";
  const ctx = await requireRole(can.schedule);
  const asset = get<MediaAsset>("SELECT * FROM media_assets WHERE id = ? AND workspace_id = ?", String(form.get("id")), ctx.workspace.id);
  if (!asset) return;
  await deleteObject(asset.storage_key);
  run("DELETE FROM media_assets WHERE id = ?", asset.id);
  audit("media.deleted", { workspaceId: ctx.workspace.id, actorId: ctx.user.id, target: asset.id });
  revalidatePath("/app/media");
}

export default async function MediaPage({ searchParams }: { searchParams: Promise<{ q?: string; folder?: string }> }) {
  const { workspace, role } = await requireWorkspace();
  const { q = "", folder = "" } = await searchParams;
  const usage = getUsage(workspace.id);
  const folders = all<{ folder: string }>(
    "SELECT DISTINCT folder FROM media_assets WHERE workspace_id = ? AND folder != '' ORDER BY folder",
    workspace.id,
  ).map((f) => f.folder);
  const like = `%${q}%`;
  const assets = all<MediaAsset>(
    `SELECT * FROM media_assets WHERE workspace_id = ? AND (? = '' OR folder = ?) AND (filename LIKE ? OR tags LIKE ?)
     ORDER BY created_at DESC LIMIT 300`,
    workspace.id, folder, folder, like, like,
  );

  return (
    <>
      <PageHeader title="Media library" description="Upload images and videos once, then reuse them in any post." />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {can.createDraft(role) && <Uploader folders={folders} />}
        </div>
        <div className="card p-5">
          <Meter label="Storage used (MB)" used={Math.round(usage.storageBytes / 1024 ** 2)} limit={PLANS[workspace.plan].storageGb * 1024} />
          <p className="mt-3 text-xs text-muted">JPG, PNG, WebP, MP4 and MOV. We check every file against each platform&apos;s size, length and aspect-ratio rules when you schedule.</p>
        </div>
      </div>

      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search name or tag" className="field max-w-xs" />
        <select name="folder" defaultValue={folder} className="field w-auto">
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <button className="btn-secondary">Filter</button>
      </form>

      {assets.length === 0 ? (
        <EmptyState title="No media yet" body="Drag files into the uploader above to build your library." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {assets.map((a) => (
            <div key={a.id} className="card group overflow-hidden">
              <div className="relative aspect-square bg-surface-2">
                {a.type === "video" ? (
                  <video src={`/media/${a.storage_key}`} className="h-full w-full object-cover" muted preload="metadata" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/media/${a.storage_key}`} alt={a.filename} className="h-full w-full object-cover" loading="lazy" />
                )}
                {a.type === "video" && (
                  <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 text-xs text-white">
                    {a.duration ? `${Math.round(a.duration)}s` : "video"}
                  </span>
                )}
              </div>
              <div className="p-2 text-xs">
                <p className="truncate font-medium" title={a.filename}>{a.filename}</p>
                <p className="text-muted">
                  {formatBytes(a.size)}
                  {a.width ? ` · ${a.width}×${a.height}` : ""}
                </p>
                {(a.folder || a.tags) && <p className="truncate text-muted">{[a.folder, a.tags].filter(Boolean).join(" · ")}</p>}
                {can.schedule(role) && (
                  <form action={deleteMedia} className="mt-1">
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-danger hover:underline">Delete</button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
