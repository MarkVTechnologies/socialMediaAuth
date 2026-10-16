import type { Platform } from "./types";

export interface PlatformRules {
  id: Platform;
  name: string;
  color: string;
  maxChars: number;
  maxHashtags: number;
  titleMax?: number;
  requiresMedia: "none" | "any" | "video";
  image?: { maxBytes: number; minRatio?: number; maxRatio?: number; formats: string[] };
  video?: { maxBytes: number; maxSeconds: number; minSeconds?: number; minRatio?: number; maxRatio?: number };
  connection: "official" | "unofficial";
  description: string;
}

const MB = 1024 * 1024;

export const PLATFORMS: Record<Platform, PlatformRules> = {
  facebook: {
    id: "facebook",
    name: "Facebook Page",
    color: "#1877F2",
    maxChars: 63206,
    maxHashtags: 5,
    requiresMedia: "none",
    image: { maxBytes: 10 * MB, formats: ["image/jpeg", "image/png", "image/webp"] },
    video: { maxBytes: 1024 * MB, maxSeconds: 240 * 60 },
    connection: "official",
    description: "Text, photos and videos to Facebook Pages via the Meta Graph API.",
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    color: "#E1306C",
    maxChars: 2200,
    maxHashtags: 30,
    requiresMedia: "any",
    image: { maxBytes: 8 * MB, minRatio: 0.8, maxRatio: 1.91, formats: ["image/jpeg"] },
    video: { maxBytes: 300 * MB, maxSeconds: 15 * 60, minSeconds: 3, minRatio: 0.5, maxRatio: 1.91 },
    connection: "official",
    description: "Images and Reels to Instagram Professional accounts.",
  },
  linkedin: {
    id: "linkedin",
    name: "LinkedIn",
    color: "#0A66C2",
    maxChars: 3000,
    maxHashtags: 5,
    requiresMedia: "none",
    image: { maxBytes: 8 * MB, formats: ["image/jpeg", "image/png"] },
    video: { maxBytes: 500 * MB, maxSeconds: 30 * 60, minSeconds: 3 },
    connection: "official",
    description: "Posts to your profile or Company Page via the LinkedIn Posts API.",
  },
  youtube: {
    id: "youtube",
    name: "YouTube",
    color: "#FF0000",
    maxChars: 5000,
    maxHashtags: 15,
    titleMax: 100,
    requiresMedia: "video",
    video: { maxBytes: 4096 * MB, maxSeconds: 12 * 3600 },
    connection: "official",
    description: "Video and Shorts uploads with title, description and tags.",
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    color: "#111111",
    maxChars: 2200,
    maxHashtags: 8,
    requiresMedia: "video",
    video: { maxBytes: 4096 * MB, maxSeconds: 10 * 60, minSeconds: 3, minRatio: 0.5, maxRatio: 0.6 },
    connection: "official",
    description: "Sends videos to your TikTok inbox to publish (Direct Post after audit).",
  },
  whatsapp_status: {
    id: "whatsapp_status",
    name: "WhatsApp Status",
    color: "#25D366",
    maxChars: 700,
    maxHashtags: 0,
    requiresMedia: "none",
    image: { maxBytes: 16 * MB, formats: ["image/jpeg", "image/png"] },
    video: { maxBytes: 16 * MB, maxSeconds: 60 },
    connection: "unofficial",
    description: "Opt-in Status autopost through a linked-device gateway. Carries ban risk.",
  },
};

export const PLATFORM_LIST = Object.values(PLATFORMS);

export const TONES = [
  { id: "professional", label: "Professional" },
  { id: "friendly", label: "Friendly" },
  { id: "bold", label: "Bold / Sales" },
  { id: "faith", label: "Faith-based" },
  { id: "luxury", label: "Luxury" },
] as const;

export const LANGUAGES = [
  { id: "en-NG", label: "English (Nigerian)" },
  { id: "pcm", label: "Nigerian Pidgin" },
] as const;
