import { apiFetch, PublishError, requireEnv, type ConnectedIdentity, type PublisherAdapter } from "./types";

/**
 * Facebook Pages + Instagram Professional accounts via the Meta Graph API.
 * Both share one Meta app and login; requires App Review + Business Verification.
 */

const V = () => process.env.META_GRAPH_VERSION || "v23.0";
const GRAPH = () => `https://graph.facebook.com/${V()}`;

const FB_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "read_insights", "business_management"];
const IG_SCOPES = [...FB_SCOPES, "instagram_basic", "instagram_content_publish", "instagram_manage_insights"];

function authorizeUrl(scopes: string[]) {
  return ({ state, redirectUri }: { state: string; redirectUri: string }) => {
    const u = new URL(`https://www.facebook.com/${V()}/dialog/oauth`);
    u.searchParams.set("client_id", requireEnv("META_APP_ID"));
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("scope", scopes.join(","));
    u.searchParams.set("response_type", "code");
    return u.toString();
  };
}

interface PageRow {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
}

async function exchangeForPages(code: string, redirectUri: string): Promise<{ pages: PageRow[]; metaUserId: string }> {
  const label = "Meta login";
  const short = await apiFetch<{ access_token: string }>(
    `${GRAPH()}/oauth/access_token?` +
      new URLSearchParams({
        client_id: requireEnv("META_APP_ID"),
        client_secret: requireEnv("META_APP_SECRET"),
        redirect_uri: redirectUri,
        code,
      }),
    { label },
  );
  // Long-lived user token -> page tokens derived from it do not expire.
  const long = await apiFetch<{ access_token: string }>(
    `${GRAPH()}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: requireEnv("META_APP_ID"),
        client_secret: requireEnv("META_APP_SECRET"),
        fb_exchange_token: short.access_token,
      }),
    { label },
  );
  const pages = await apiFetch<{ data: PageRow[] }>(
    `${GRAPH()}/me/accounts?` +
      new URLSearchParams({
        fields: "id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}",
        access_token: long.access_token,
        limit: "100",
      }),
    { label },
  );
  const me = await apiFetch<{ id: string }>(`${GRAPH()}/me?fields=id&access_token=${encodeURIComponent(long.access_token)}`, { label });
  return { pages: pages.data, metaUserId: me.id };
}

function form(params: Record<string, string | undefined>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") body.set(k, v);
  return { method: "POST", body } as const;
}

export const facebook: PublisherAdapter = {
  platform: "facebook",
  requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
  authorizeUrl: authorizeUrl(FB_SCOPES),

  async handleCallback(code, redirectUri) {
    const { pages, metaUserId } = await exchangeForPages(code, redirectUri);
    return pages.map<ConnectedIdentity>((p) => ({
      externalId: p.id,
      name: p.name,
      avatarUrl: p.picture?.data?.url ?? null,
      accessToken: p.access_token,
      expiresAt: null,
      meta: { metaUserId },
    }));
  },

  async refreshToken() {
    return null; // page tokens from a long-lived user token don't expire
  },

  async publish({ account, accessToken, variant, media, settings }) {
    const token = accessToken!;
    const pageId = account.external_id;
    const label = "Facebook";
    const video = media.find((m) => m.type === "video");
    const images = media.filter((m) => m.type === "image");
    let id: string;

    if (video) {
      const r = await apiFetch<{ id: string }>(
        `${GRAPH()}/${pageId}/videos`,
        { ...form({ file_url: video.url, description: variant.text, access_token: token }), label },
      );
      id = r.id;
    } else if (images.length === 1) {
      const r = await apiFetch<{ id: string; post_id?: string }>(
        `${GRAPH()}/${pageId}/photos`,
        { ...form({ url: images[0].url, caption: variant.text, access_token: token }), label },
      );
      id = r.post_id ?? r.id;
    } else if (images.length > 1) {
      const ids: string[] = [];
      for (const img of images) {
        const r = await apiFetch<{ id: string }>(
          `${GRAPH()}/${pageId}/photos`,
          { ...form({ url: img.url, published: "false", access_token: token }), label },
        );
        ids.push(r.id);
      }
      const body = new URLSearchParams({ message: variant.text, access_token: token });
      ids.forEach((mid, i) => body.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: mid })));
      const r = await apiFetch<{ id: string }>(`${GRAPH()}/${pageId}/feed`, { method: "POST", body, label });
      id = r.id;
    } else {
      const r = await apiFetch<{ id: string }>(
        `${GRAPH()}/${pageId}/feed`,
        { ...form({ message: variant.text, link: (settings.link as string) || undefined, access_token: token }), label },
      );
      id = r.id;
    }

    const firstComment = (settings.firstComment as string)?.trim();
    if (firstComment) {
      await apiFetch(`${GRAPH()}/${id}/comments`, { ...form({ message: firstComment, access_token: token }), label }).catch(
        () => undefined, // a failed first comment shouldn't fail the post
      );
    }
    return { platformPostId: id, url: `https://www.facebook.com/${id}` };
  },

  async getMetrics(_account, accessToken, postId) {
    const r = await apiFetch<{
      shares?: { count: number };
      comments?: { summary?: { total_count: number } };
      reactions?: { summary?: { total_count: number } };
    }>(
      `${GRAPH()}/${postId}?` +
        new URLSearchParams({
          fields: "shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)",
          access_token: accessToken!,
        }),
      { label: "Facebook metrics" },
    );
    return {
      likes: r.reactions?.summary?.total_count,
      comments: r.comments?.summary?.total_count,
      shares: r.shares?.count,
    };
  },
};

export const instagram: PublisherAdapter = {
  platform: "instagram",
  requiredEnv: ["META_APP_ID", "META_APP_SECRET"],
  authorizeUrl: authorizeUrl(IG_SCOPES),

  async handleCallback(code, redirectUri) {
    const { pages, metaUserId } = await exchangeForPages(code, redirectUri);
    return pages
      .filter((p) => p.instagram_business_account)
      .map<ConnectedIdentity>((p) => ({
        externalId: p.instagram_business_account!.id,
        name: "@" + (p.instagram_business_account!.username ?? p.name),
        avatarUrl: p.instagram_business_account!.profile_picture_url ?? null,
        accessToken: p.access_token,
        expiresAt: null,
        meta: { pageId: p.id, metaUserId },
      }));
  },

  async refreshToken() {
    return null;
  },

  async publish({ account, accessToken, variant, media, settings }) {
    const token = accessToken!;
    const igId = account.external_id;
    const label = "Instagram";
    if (media.length === 0) throw new PublishError("Instagram posts need an image or video.", true, "edit_media");

    const createContainer = (m: (typeof media)[number], carouselItem: boolean) =>
      apiFetch<{ id: string }>(`${GRAPH()}/${igId}/media`, {
        ...form({
          ...(m.type === "video" ? { media_type: carouselItem ? "VIDEO" : "REELS", video_url: m.url } : { image_url: m.url }),
          ...(carouselItem ? { is_carousel_item: "true" } : { caption: variant.text }),
          ...(m.type === "image" && !carouselItem && settings.altText ? { alt_text: settings.altText as string } : {}),
          access_token: token,
        }),
        label,
      });

    let containerId: string;
    if (media.length === 1) {
      containerId = (await createContainer(media[0], false)).id;
    } else {
      const children = [];
      for (const m of media.slice(0, 10)) children.push((await createContainer(m, true)).id);
      for (const c of children) await waitForContainer(c, token);
      containerId = (
        await apiFetch<{ id: string }>(`${GRAPH()}/${igId}/media`, {
          ...form({ media_type: "CAROUSEL", children: children.join(","), caption: variant.text, access_token: token }),
          label,
        })
      ).id;
    }
    await waitForContainer(containerId, token);
    const published = await apiFetch<{ id: string }>(`${GRAPH()}/${igId}/media_publish`, {
      ...form({ creation_id: containerId, access_token: token }),
      label,
    });
    const info = await apiFetch<{ permalink?: string }>(
      `${GRAPH()}/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`,
      { label },
    ).catch(() => ({ permalink: undefined }));

    const firstComment = (settings.firstComment as string)?.trim();
    if (firstComment) {
      await apiFetch(`${GRAPH()}/${published.id}/comments`, { ...form({ message: firstComment, access_token: token }), label }).catch(
        () => undefined,
      );
    }
    return { platformPostId: published.id, url: info.permalink ?? null };
  },

  async getMetrics(_account, accessToken, postId) {
    const r = await apiFetch<{ like_count?: number; comments_count?: number }>(
      `${GRAPH()}/${postId}?fields=like_count,comments_count&access_token=${encodeURIComponent(accessToken!)}`,
      { label: "Instagram metrics" },
    );
    return { likes: r.like_count, comments: r.comments_count };
  },
};

async function waitForContainer(id: string, token: string) {
  for (let i = 0; i < 30; i++) {
    const r = await apiFetch<{ status_code: string }>(
      `${GRAPH()}/${id}?fields=status_code&access_token=${encodeURIComponent(token)}`,
      { label: "Instagram" },
    );
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED")
      throw new PublishError("Instagram could not process this media. Check its format and size.", true, "edit_media");
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new PublishError("Instagram is still processing the media; will retry.", false);
}
