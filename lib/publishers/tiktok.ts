import { flagEnabled } from "../flags";
import { apiFetch, PublishError, requireEnv, type PublisherAdapter } from "./types";

/**
 * TikTok Content Posting API.
 * Default "inbox" mode uploads a draft the creator publishes in the TikTok app.
 * Direct Post is enabled via the `tiktok_direct_post` feature flag after TikTok's audit.
 * PULL_FROM_URL requires the media domain to be verified in the TikTok developer portal.
 */

const API = "https://open.tiktokapis.com/v2";

interface TikTokEnvelope<T> {
  data: T;
  error: { code: string; message: string };
}

async function tiktok<T>(path: string, token: string, body: unknown, label = "TikTok"): Promise<T> {
  const r = await apiFetch<TikTokEnvelope<T>>(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
    label,
  });
  if (r.error && r.error.code !== "ok") {
    const code = r.error.code;
    const temporary = code === "rate_limit_exceeded" || code === "internal_error";
    const reconnect = code === "access_token_invalid" || code === "scope_not_authorized";
    throw new PublishError(`TikTok: ${r.error.message || code}`, !temporary, reconnect ? "reconnect" : "edit_post");
  }
  return r.data;
}

async function tokenRequest(params: Record<string, string>) {
  const r = await apiFetch<{
    access_token: string;
    expires_in: number;
    refresh_token: string;
    open_id: string;
    error?: string;
    error_description?: string;
  }>(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: requireEnv("TIKTOK_CLIENT_KEY"),
      client_secret: requireEnv("TIKTOK_CLIENT_SECRET"),
      ...params,
    }),
    label: "TikTok login",
  });
  if (r.error) throw new PublishError(`TikTok: ${r.error_description || r.error}`, true, "reconnect");
  return r;
}

export const tiktokAdapter: PublisherAdapter = {
  platform: "tiktok",
  requiredEnv: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],

  authorizeUrl({ state, redirectUri, codeChallenge }) {
    const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
    u.searchParams.set("client_key", requireEnv("TIKTOK_CLIENT_KEY"));
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "user.info.basic,video.upload,video.publish");
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", codeChallenge);
    u.searchParams.set("code_challenge_method", "S256");
    return u.toString();
  },

  async handleCallback(code, redirectUri, codeVerifier) {
    const tok = await tokenRequest({
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    const info = await apiFetch<TikTokEnvelope<{ user: { open_id: string; display_name: string; avatar_url?: string } }>>(
      `${API}/user/info/?fields=open_id,display_name,avatar_url`,
      { headers: { Authorization: `Bearer ${tok.access_token}` }, label: "TikTok" },
    );
    return [
      {
        externalId: tok.open_id,
        name: info.data.user.display_name,
        avatarUrl: info.data.user.avatar_url ?? null,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      },
    ];
  },

  async refreshToken(_account, refreshToken) {
    if (!refreshToken) throw new PublishError("TikTok connection expired. Reconnect.", true, "reconnect");
    const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      expiresAt: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    };
  },

  async publish({ accessToken, variant, media, settings }) {
    const video = media.find((m) => m.type === "video");
    if (!video) throw new PublishError("TikTok needs a video.", true, "edit_media");
    const token = accessToken!;
    const source_info = { source: "PULL_FROM_URL", video_url: video.url };

    if (!flagEnabled("tiktok_direct_post")) {
      const r = await tiktok<{ publish_id: string }>("/post/publish/inbox/video/init/", token, { source_info });
      return { platformPostId: r.publish_id, url: null }; // creator finishes in the TikTok app
    }

    // Direct Post: required UX elements (privacy, interaction toggles, commercial disclosure)
    // are collected in the composer and passed through `settings`.
    const creator = await tiktok<{ privacy_level_options: string[] }>("/post/publish/creator_info/query/", token, {});
    const privacy = (settings.privacyLevel as string) || "SELF_ONLY";
    if (!creator.privacy_level_options.includes(privacy)) {
      throw new PublishError(`TikTok does not allow privacy "${privacy}" for this account.`, true, "edit_post");
    }
    const r = await tiktok<{ publish_id: string }>("/post/publish/video/init/", token, {
      post_info: {
        title: variant.text.slice(0, 2200),
        privacy_level: privacy,
        disable_comment: Boolean(settings.disableComment),
        disable_duet: Boolean(settings.disableDuet),
        disable_stitch: Boolean(settings.disableStitch),
        brand_content_toggle: Boolean(settings.brandedContent),
        brand_organic_toggle: Boolean(settings.yourBrand),
      },
      source_info,
    });
    return { platformPostId: r.publish_id, url: null };
  },
};
