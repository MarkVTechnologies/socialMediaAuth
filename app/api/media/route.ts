import { NextResponse } from "next/server";
import path from "node:path";
import { run, now } from "@/lib/db";
import { id } from "@/lib/crypto";
import { ACCEPTED_MIME, probe, putObject } from "@/lib/media";
import { can, checkLimit, requireWorkspace } from "@/lib/workspace";

/** Multipart upload of one or more files (field name "files"). */
export async function POST(req: Request) {
  const ctx = await requireWorkspace();
  if (!can.createDraft(ctx.role)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const folder = String(form.get("folder") || "").trim().slice(0, 60);
  const tags = String(form.get("tags") || "").trim().slice(0, 200);
  if (files.length === 0) return NextResponse.json({ error: "No files received" }, { status: 400 });

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const limit = checkLimit(ctx.workspace, "storage", totalBytes);
  if (limit) return NextResponse.json({ error: limit }, { status: 402 });

  const results: { id?: string; filename: string; error?: string }[] = [];
  for (const file of files) {
    const type = ACCEPTED_MIME[file.type];
    if (!type) {
      results.push({ filename: file.name, error: "Unsupported type. Use JPG, PNG, WebP, MP4 or MOV." });
      continue;
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const meta = probe(buf, file.type);
    const assetId = id("med_");
    const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "") || (type === "image" ? ".jpg" : ".mp4");
    const key = `${ctx.workspace.id}/${assetId}${ext}`;
    await putObject(key, buf);
    run(
      `INSERT INTO media_assets (id, workspace_id, filename, storage_key, mime, type, size, width, height, duration, tags, folder, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      assetId, ctx.workspace.id, file.name.slice(0, 200), key, file.type, type, file.size,
      meta.width, meta.height, meta.duration, tags, folder, now(),
    );
    results.push({ id: assetId, filename: file.name });
  }
  return NextResponse.json({ results });
}
