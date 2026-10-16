import fs from "node:fs/promises";
import path from "node:path";
import type { MediaAsset } from "./types";

/**
 * Media storage. Files are stored on local disk and served from /media/<key>.
 * Public URLs are needed because TikTok, Instagram and others pull media from a URL.
 * Swap `putObject`/`readObject` for Cloudflare R2 / S3 in production.
 */

const UPLOAD_DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "uploads");

export const ACCEPTED_MIME: Record<string, "image" | "video"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
};

export async function putObject(key: string, data: Buffer) {
  const file = path.join(UPLOAD_DIR, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
}

export async function readObject(key: string): Promise<Buffer | null> {
  const file = path.join(UPLOAD_DIR, key);
  if (!file.startsWith(UPLOAD_DIR + path.sep)) return null;
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

export async function deleteObject(key: string) {
  await fs.rm(path.join(UPLOAD_DIR, key), { force: true });
}

export function publicMediaUrl(asset: Pick<MediaAsset, "storage_key">) {
  const base = (process.env.MEDIA_PUBLIC_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/media/${asset.storage_key}`;
}

// ---- Metadata probing (no native deps) ----

export interface Probe {
  width: number | null;
  height: number | null;
  duration: number | null;
}

export function probe(buf: Buffer, mime: string): Probe {
  try {
    if (mime === "image/png" && buf.length > 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), duration: null };
    }
    if (mime === "image/jpeg") return { ...jpegSize(buf), duration: null };
    if (mime === "image/webp") return { ...webpSize(buf), duration: null };
    if (mime === "video/mp4" || mime === "video/quicktime") return mp4Info(buf);
  } catch {
    // fall through
  }
  return { width: null, height: null, duration: null };
}

function jpegSize(buf: Buffer) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return { width: null, height: null };
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return { width: null, height: null };
}

function webpSize(buf: Buffer) {
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  return { width: null, height: null };
}

/** Walk MP4/MOV boxes to read duration (mvhd) and video track size (tkhd). */
function mp4Info(buf: Buffer): Probe {
  const out: Probe = { width: null, height: null, duration: null };
  const walk = (start: number, end: number) => {
    let i = start;
    while (i + 8 <= end) {
      let size = buf.readUInt32BE(i);
      const type = buf.toString("ascii", i + 4, i + 8);
      let header = 8;
      if (size === 1) {
        size = Number(buf.readBigUInt64BE(i + 8));
        header = 16;
      } else if (size === 0) size = end - i;
      if (size < header) return;
      const body = i + header;
      if (type === "moov" || type === "trak") walk(body, Math.min(i + size, end));
      else if (type === "mvhd") {
        const v = buf[body];
        const timescale = v === 1 ? buf.readUInt32BE(body + 20) : buf.readUInt32BE(body + 12);
        const dur = v === 1 ? Number(buf.readBigUInt64BE(body + 24)) : buf.readUInt32BE(body + 16);
        if (timescale) out.duration = Math.round((dur / timescale) * 10) / 10;
      } else if (type === "tkhd") {
        const v = buf[body];
        const off = body + (v === 1 ? 88 : 76);
        const w = buf.readUInt32BE(off) >> 16;
        const h = buf.readUInt32BE(off + 4) >> 16;
        if (w && h && !out.width) {
          out.width = w;
          out.height = h;
        }
      }
      i += size;
    }
  };
  walk(0, buf.length);
  return out;
}

export { validateForPlatform, formatBytes, type MediaIssue } from "./validation";
