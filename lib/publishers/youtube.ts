import { apiFetch, PublishError, requireEnv, type PublisherAdapter } from "./types";

/** YouTube Data API v3 — video and Shorts uploads. Requires Google OAuth verification. */

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

async function tokenRequest(params: Record<string, string>) {
  return apiFetch<{ access_token: string; expires_in: number; refresh_token?: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      ...params,
    }),
    label: "Google login",
  });
}

export const youtube: PublisherAdapter = {
  platform: "youtube",
  requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],

  authorizeUrl({ state, redirectUri, codeChallenge }) {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", requireEnv("GOOGLE_CLIENT_ID"));
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", SCOPES.join(" "));
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("include_granted_scopes", "true");
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", codeChallenge);
    u.searchParams.set("code_challenge_method", "S256");
    return u.toString();
  },

  async handleCallback(code, redirectUri, codeVerifier) {
    const tok = await tokenRequest({
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    });
    const channels = await apiFetch<{ items?: { id: string; snippet: { title: string; thumbnails?: { default?: { url: string } } } }[] }>(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${tok.access_token}` }, label: "YouTube" },
    );
    if (!channels.items?.length) throw new Error("This Google account has no YouTube channel.");
    return channels.items.map((c) => ({
      externalId: c.id,
      name: c.snippet.title,
      avatarUrl: c.snippet.thumbnails?.default?.url ?? null,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? null,
      expiresAt: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    }));
  },

  async refreshToken(_account, refreshToken) {
    if (!refreshToken) throw new PublishError("YouTube connection has no refresh token. Reconnect the channel.", true, "reconnect");
    const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    };
  },

  async disconnect(_account, accessToken) {
    if (accessToken)
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, { method: "POST" }).catch(
        () => undefined,
      );
  },

  async publish({ accessToken, variant, media, settings }) {
    const video = media.find((m) => m.type === "video");
    if (!video) throw new PublishError("YouTube needs a video.", true, "edit_media");
    const token = accessToken!;

    const isShort = (video.duration ?? 999) <= 60 && (video.height ?? 0) >= (video.width ?? 1);
    const metadata = {
      snippet: {
        title: (variant.title || variant.text.split("\n")[0] || "Untitled").slice(0, 100),
        description: variant.text.slice(0, 5000),
        tags: (variant.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 30),
        categoryId: (settings.categoryId as string) || "22",
      },
      status: {
        privacyStatus: (settings.visibility as string) || "public",
        selfDeclaredMadeForKids: Boolean(settings.madeForKids),
      },
    };

    const init = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": video.mime,
          "X-Upload-Content-Length": String(video.size),
        },
        body: JSON.stringify(metadata),
      },
    ).catch((e) => {
      throw new PublishError(`YouTube: network error (${e.message})`, false);
    });
    if (!init.ok) {
      const t = await init.text();
      const quota = t.includes("quotaExceeded") || t.includes("uploadLimitExceeded");
      throw new PublishError(
        quota ? "YouTube daily upload quota reached; will retry later." : `YouTube: ${t.slice(0, 300)}`,
        quota || init.status >= 500 ? false : true,
        init.status === 401 ? "reconnect" : "edit_post",
      );
    }
    const uploadUrl = init.headers.get("location")!;
    const file = await fetch(video.url);
    if (!file.ok || !file.body) throw new PublishError("Could not read the video file.", false);
    const result = await apiFetch<{ id: string }>(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": video.mime, "Content-Length": String(video.size) },
      body: Buffer.from(await file.arrayBuffer()),
      label: "YouTube upload",
    });
    return {
      platformPostId: result.id,
      url: isShort ? `https://youtube.com/shorts/${result.id}` : `https://www.youtube.com/watch?v=${result.id}`,
    };
  },

  async getMetrics(_account, accessToken, postId) {
    const r = await apiFetch<{ items: { statistics: Record<string, string> }[] }>(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${postId}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, label: "YouTube metrics" },
    );
    const s = r.items[0]?.statistics ?? {};
    return { views: +s.viewCount || 0, likes: +s.likeCount || 0, comments: +s.commentCount || 0 };
  },
};
