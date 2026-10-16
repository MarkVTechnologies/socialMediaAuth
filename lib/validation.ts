import { PLATFORMS } from "./platforms";
import type { MediaAsset, Platform } from "./types";

/** Pure (client-safe) media checks against each platform's requirements. */

export interface MediaIssue {
  level: "error" | "warning";
  message: string;
}

export function validateForPlatform(platform: Platform, media: MediaAsset[]): MediaIssue[] {
  const rules = PLATFORMS[platform];
  const issues: MediaIssue[] = [];
  const videos = media.filter((m) => m.type === "video");

  if (rules.requiresMedia === "any" && media.length === 0) {
    issues.push({ level: "error", message: `${rules.name} posts need at least one image or video.` });
  }
  if (rules.requiresMedia === "video" && videos.length === 0) {
    issues.push({ level: "error", message: `${rules.name} needs a video.` });
  }
  if ((platform === "youtube" || platform === "tiktok") && media.length > 1) {
    issues.push({ level: "warning", message: `${rules.name} uses only the first video; other media is ignored.` });
  }

  for (const m of media) {
    const ratio = m.width && m.height ? m.width / m.height : null;
    if (m.type === "image") {
      const r = rules.image;
      if (!r) {
        if (rules.requiresMedia === "video")
          issues.push({ level: "warning", message: `${m.filename}: images are not posted to ${rules.name}.` });
        continue;
      }
      if (!r.formats.includes(m.mime))
        issues.push({
          level: platform === "instagram" ? "warning" : "error",
          message: `${m.filename}: ${rules.name} prefers ${r.formats.map((f) => f.split("/")[1].toUpperCase()).join("/")}.`,
        });
      if (m.size > r.maxBytes)
        issues.push({ level: "error", message: `${m.filename}: larger than ${r.maxBytes / 1024 ** 2} MB limit.` });
      if (ratio && r.minRatio && (ratio < r.minRatio || ratio > (r.maxRatio ?? 99)))
        issues.push({
          level: "warning",
          message: `${m.filename}: aspect ratio ${ratio.toFixed(2)} is outside ${r.minRatio}–${r.maxRatio}; it may be cropped.`,
        });
    } else {
      const r = rules.video;
      if (!r) continue;
      if (m.size > r.maxBytes)
        issues.push({ level: "error", message: `${m.filename}: larger than ${r.maxBytes / 1024 ** 2} MB limit.` });
      if (m.duration != null && m.duration > r.maxSeconds)
        issues.push({ level: "error", message: `${m.filename}: longer than ${Math.round(r.maxSeconds / 60)} minutes.` });
      if (m.duration != null && r.minSeconds && m.duration < r.minSeconds)
        issues.push({ level: "error", message: `${m.filename}: shorter than ${r.minSeconds} seconds.` });
      if (ratio && r.minRatio && (ratio < r.minRatio || ratio > (r.maxRatio ?? 99)))
        issues.push({
          level: "warning",
          message: `${m.filename}: aspect ratio ${ratio.toFixed(2)} isn't ideal for ${rules.name} (vertical 9:16 recommended).`,
        });
      if (m.mime === "video/quicktime")
        issues.push({ level: "warning", message: `${m.filename}: MOV is accepted, but MP4 (H.264) is the most compatible format.` });
    }
  }
  return issues;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
