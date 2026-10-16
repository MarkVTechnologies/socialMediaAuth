import { PublishError, type PublisherAdapter, type PublishResult } from "./types";
import type { Platform } from "../types";

/**
 * Simulated publisher for development and app-review demo recordings.
 * Include "#failtemp" in the text to simulate a temporary failure (retried),
 * or "#failperm" for a permanent one.
 */
export function demoAdapter(platform: Platform): PublisherAdapter {
  return {
    platform,
    requiredEnv: [],
    authorizeUrl: () => {
      throw new Error("Demo accounts don't use OAuth");
    },
    handleCallback: async () => [],
    refreshToken: async () => null,
    async publish({ variant }): Promise<PublishResult> {
      await new Promise((r) => setTimeout(r, 400));
      if (variant.text.includes("#failtemp")) throw new PublishError("Demo: simulated network timeout", false);
      if (variant.text.includes("#failperm"))
        throw new PublishError("Demo: simulated rejected media — the video is too long for this platform.", true, "edit_media");
      const id = `demo_${Date.now().toString(36)}`;
      return { platformPostId: id, url: null };
    },
    async getMetrics() {
      const r = () => Math.floor(Math.random() * 50);
      return { views: 100 + r() * 20, likes: r(), comments: Math.floor(r() / 5), shares: Math.floor(r() / 4) };
    },
  };
}
