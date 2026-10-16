import { apiFetch, PublishError, requireEnv, type PublisherAdapter } from "./types";

/**
 * LinkedIn Posts API. Personal profiles use w_member_social (open);
 * Company Pages need Community Management API approval (w_organization_social).
 */

const VERSION = () => process.env.LINKEDIN_API_VERSION || "202509";
const companyPages = () => process.env.LINKEDIN_COMPANY_PAGES === "true";

function headers(token: string, json = true): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": VERSION(),
    "X-Restli-Protocol-Version": "2.0.0",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

async function uploadMedia(kind: "image" | "video", owner: string, url: string, token: string): Promise<string> {
  const label = "LinkedIn upload";
  const file = await fetch(url);
  if (!file.ok) throw new PublishError("Could not read media file for LinkedIn upload.", false);
  const bytes = Buffer.from(await file.arrayBuffer());

  if (kind === "image") {
    const init = await apiFetch<{ value: { uploadUrl: string; image: string } }>(
      "https://api.linkedin.com/rest/images?action=initializeUpload",
      { method: "POST", headers: headers(token), body: JSON.stringify({ initializeUploadRequest: { owner } }), label },
    );
    await apiFetch(init.value.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: bytes, label });
    return init.value.image;
  }

  const init = await apiFetch<{
    value: { video: string; uploadToken: string; uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[] };
  }>("https://api.linkedin.com/rest/videos?action=initializeUpload", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false },
    }),
    label,
  });
  const etags: string[] = [];
  for (const part of init.value.uploadInstructions) {
    const res = await fetch(part.uploadUrl, { method: "PUT", body: bytes.subarray(part.firstByte, part.lastByte + 1) });
    if (!res.ok) throw new PublishError(`LinkedIn video upload failed (${res.status}).`, res.status >= 500);
    etags.push(res.headers.get("etag") ?? "");
  }
  await apiFetch("https://api.linkedin.com/rest/videos?action=finalizeUpload", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken, uploadedPartIds: etags },
    }),
    label,
  });
  return init.value.video;
}

export const linkedin: PublisherAdapter = {
  platform: "linkedin",
  requiredEnv: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],

  authorizeUrl({ state, redirectUri }) {
    const scopes = ["openid", "profile", "w_member_social"];
    if (companyPages()) scopes.push("r_organization_admin", "w_organization_social");
    const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", requireEnv("LINKEDIN_CLIENT_ID"));
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("scope", scopes.join(" "));
    return u.toString();
  },

  async handleCallback(code, redirectUri) {
    const label = "LinkedIn login";
    const tok = await apiFetch<{ access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number }>(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: requireEnv("LINKEDIN_CLIENT_ID"),
          client_secret: requireEnv("LINKEDIN_CLIENT_SECRET"),
        }),
        label,
      },
    );
    const me = await apiFetch<{ sub: string; name: string; picture?: string }>("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
      label,
    });
    const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
    const identities = [
      {
        externalId: `urn:li:person:${me.sub}`,
        name: me.name,
        avatarUrl: me.picture ?? null,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? null,
        expiresAt,
        meta: { kind: "profile" },
      },
    ];
    if (companyPages()) {
      const orgs = await apiFetch<{ elements: { organization: string }[] }>(
        "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED",
        { headers: headers(tok.access_token), label },
      ).catch(() => ({ elements: [] }));
      for (const o of orgs.elements) {
        const orgId = o.organization.split(":").pop()!;
        const org = await apiFetch<{ localizedName: string }>(`https://api.linkedin.com/rest/organizations/${orgId}`, {
          headers: headers(tok.access_token),
          label,
        }).catch(() => ({ localizedName: `Company ${orgId}` }));
        identities.push({
          externalId: o.organization,
          name: org.localizedName,
          avatarUrl: null,
          accessToken: tok.access_token,
          refreshToken: tok.refresh_token ?? null,
          expiresAt,
          meta: { kind: "organization" },
        });
      }
    }
    return identities;
  },

  async refreshToken(_account, refreshToken) {
    if (!refreshToken) return null;
    const tok = await apiFetch<{ access_token: string; expires_in: number; refresh_token?: string }>(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: requireEnv("LINKEDIN_CLIENT_ID"),
          client_secret: requireEnv("LINKEDIN_CLIENT_SECRET"),
        }),
        label: "LinkedIn token refresh",
      },
    );
    return {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    };
  },

  async publish({ account, accessToken, variant, media }) {
    const token = accessToken!;
    const author = account.external_id;
    const body: Record<string, unknown> = {
      author,
      commentary: escapeLittleText(variant.text),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    const video = media.find((m) => m.type === "video");
    const images = media.filter((m) => m.type === "image");
    if (video) {
      body.content = { media: { id: await uploadMedia("video", author, video.url, token), title: variant.title ?? undefined } };
    } else if (images.length === 1) {
      body.content = { media: { id: await uploadMedia("image", author, images[0].url, token) } };
    } else if (images.length > 1) {
      const ids = [];
      for (const img of images.slice(0, 20)) ids.push({ id: await uploadMedia("image", author, img.url, token) });
      body.content = { multiImage: { images: ids } };
    }

    const res = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    }).catch((e) => {
      throw new PublishError(`LinkedIn: network error (${e.message})`, false);
    });
    if (!res.ok) {
      const text = await res.text();
      const permanent = res.status < 500 && res.status !== 429;
      throw new PublishError(`LinkedIn: ${text.slice(0, 300)}`, permanent, res.status === 401 ? "reconnect" : "edit_post");
    }
    const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") ?? "";
    return { platformPostId: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null };
  },
};

/** LinkedIn "little text" format reserves some characters. */
function escapeLittleText(s: string) {
  return s.replace(/[\\|{}@[\]()<>*_~]/g, (c) => "\\" + c);
}
