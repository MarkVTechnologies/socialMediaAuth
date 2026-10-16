import { facebook, instagram } from "./meta";
import { linkedin } from "./linkedin";
import { youtube } from "./youtube";
import { tiktokAdapter } from "./tiktok";
import { whatsappStatus } from "./whatsapp";
import { demoAdapter } from "./demo";
import type { Platform, SocialAccount } from "../types";
import type { PublisherAdapter } from "./types";

const ADAPTERS: Record<Platform, PublisherAdapter> = {
  facebook,
  instagram,
  linkedin,
  youtube,
  tiktok: tiktokAdapter,
  whatsapp_status: whatsappStatus,
};

export function adapterFor(platform: Platform): PublisherAdapter {
  return ADAPTERS[platform];
}

export function adapterForAccount(account: Pick<SocialAccount, "platform" | "connection_type">): PublisherAdapter {
  return account.connection_type === "demo" ? demoAdapter(account.platform) : ADAPTERS[account.platform];
}

/** True when the official OAuth app credentials for this platform are configured. */
export function isConfigured(platform: Platform) {
  return ADAPTERS[platform].requiredEnv.every((k) => Boolean(process.env[k]));
}

export { PublishError } from "./types";
