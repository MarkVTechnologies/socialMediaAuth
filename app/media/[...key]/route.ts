import { get } from "@/lib/db";
import { readObject } from "@/lib/media";

/**
 * Public media URLs. Platforms (TikTok, Instagram, Facebook) pull media from these URLs,
 * so they're unauthenticated but unguessable (random asset IDs). Use a CDN / R2 in production.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const storageKey = key.join("/");
  const asset = get<{ mime: string; size: number }>("SELECT mime, size FROM media_assets WHERE storage_key = ?", storageKey);
  if (!asset) return new Response("Not found", { status: 404 });
  const data = await readObject(storageKey);
  if (!data) return new Response("Not found", { status: 404 });

  const headers = {
    "Content-Type": asset.mime,
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
  };
  // Range support so videos can be previewed and streamed.
  const range = req.headers.get("range");
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
    return new Response(new Uint8Array(data.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${data.length}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, "Content-Length": String(data.length) } });
}
