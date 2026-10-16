import type { MediaAsset, Platform, PostVariant, SocialAccount } from "../types";

/** Tokens and identity returned from an OAuth callback; one entry per page/channel/profile. */
export interface ConnectedIdentity {
  externalId: string;
  name: string;
  avatarUrl?: string | null;
  accessToken: string | null;
  refreshToken?: string | null;
  expiresAt?: string | null;
  meta?: Record<string, unknown>;
}

export interface AuthorizeParams {
  state: string;
  redirectUri: string;
  codeChallenge: string;
}

export interface PublishContext {
  account: SocialAccount;
  accessToken: string | null;
  variant: PostVariant;
  settings: Record<string, unknown>;
  media: (MediaAsset & { url: string })[];
}

export interface PublishResult {
  platformPostId: string;
  url: string | null;
}

export interface Metrics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  watchTime?: number;
}

/** PRD §6.3 — every platform implements the same interface. */
export interface PublisherAdapter {
  platform: Platform;
  /** Env vars required for the official integration. */
  requiredEnv: string[];
  authorizeUrl(p: AuthorizeParams): string;
  handleCallback(code: string, redirectUri: string, codeVerifier: string): Promise<ConnectedIdentity[]>;
  /** Returns new tokens, or null if the platform has no refresh (e.g. long-lived page tokens). */
  refreshToken(account: SocialAccount, refreshToken: string | null): Promise<Partial<ConnectedIdentity> | null>;
  disconnect?(account: SocialAccount, accessToken: string | null): Promise<void>;
  publish(ctx: PublishContext): Promise<PublishResult>;
  getMetrics?(account: SocialAccount, accessToken: string | null, platformPostId: string): Promise<Metrics>;
}

/**
 * `permanent` errors stop retries and alert the customer (expired token, rejected media);
 * temporary errors (network, rate limits, 5xx) are retried with back-off.
 */
export class PublishError extends Error {
  constructor(
    message: string,
    public permanent: boolean,
    public fix?: "reconnect" | "edit_media" | "edit_post",
  ) {
    super(message);
  }
}

/** fetch wrapper that classifies failures into PublishError. */
export async function apiFetch<T = unknown>(url: string, init: RequestInit & { label: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new PublishError(`${init.label}: network error (${(e as Error).message})`, false);
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // keep text
  }
  if (res.ok) return body as T;

  const detail = extractMessage(body) || res.statusText;
  if (res.status === 401 || isMetaTokenError(body)) {
    throw new PublishError(`${init.label}: your connection has expired. Reconnect the account. (${detail})`, true, "reconnect");
  }
  if (res.status === 403) {
    throw new PublishError(`${init.label}: permission denied — ${detail}`, true, "reconnect");
  }
  if (res.status === 429 || res.status >= 500) {
    throw new PublishError(`${init.label}: temporarily unavailable (${res.status}) — ${detail}`, false);
  }
  throw new PublishError(`${init.label}: ${detail}`, true, "edit_post");
}

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return typeof body === "string" ? body.slice(0, 300) : null;
  const b = body as {
    error?: string | { message?: string; code?: string | number };
    error_description?: string;
    message?: string;
  };
  if (typeof b.error === "string") return b.error;
  return b.error?.message || b.error_description || b.message || (b.error?.code != null ? String(b.error.code) : null);
}

function isMetaTokenError(body: unknown) {
  const code = (body as { error?: { code?: number } } | null)?.error?.code;
  return code === 190 || code === 102;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}
