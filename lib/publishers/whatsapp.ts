import { apiFetch, PublishError, type PublisherAdapter } from "./types";

/**
 * WhatsApp Status autopost via an UNOFFICIAL linked-device gateway (e.g. Whapi.Cloud).
 * Not supported by Meta's official API; carries number-ban risk. Opt-in only, behind the
 * `whatsapp_status` feature flag, with a daily cap enforced by the scheduler.
 *
 * The customer pairs their number in the gateway dashboard (QR code) and pastes the
 * gateway channel token here. Endpoint paths follow Whapi.Cloud's stories API; verify
 * against the gateway's current docs before enabling for customers.
 */

const BASE = () => (process.env.WHATSAPP_GATEWAY_URL || "https://gate.whapi.cloud").replace(/\/$/, "");

export const WHATSAPP_STATUS_DAILY_CAP = Number(process.env.WHATSAPP_STATUS_DAILY_CAP || 5);

export const whatsappStatus: PublisherAdapter = {
  platform: "whatsapp_status",
  requiredEnv: [],

  authorizeUrl() {
    throw new Error("WhatsApp Status connects with a gateway token, not OAuth.");
  },
  async handleCallback() {
    throw new Error("WhatsApp Status connects with a gateway token, not OAuth.");
  },
  async refreshToken() {
    return null;
  },

  async publish({ accessToken, variant, media }) {
    if (!accessToken) throw new PublishError("WhatsApp gateway token missing. Reconnect.", true, "reconnect");
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    const m = media[0];
    const label = "WhatsApp Status";
    const r = m
      ? await apiFetch<{ message?: { id: string }; id?: string }>(`${BASE()}/stories/send/media`, {
          method: "POST",
          headers,
          body: JSON.stringify({ media: m.url, caption: variant.text, mime_type: m.mime }),
          label,
        })
      : await apiFetch<{ message?: { id: string }; id?: string }>(`${BASE()}/stories/send/text`, {
          method: "POST",
          headers,
          body: JSON.stringify({ caption: variant.text, background_color: "#128C7E", font_type: "SANS_SERIF" }),
          label,
        });
    return { platformPostId: r.message?.id ?? r.id ?? "status", url: null };
  },
};

/** Verifies a gateway token and returns the paired phone/profile name. */
export async function verifyGatewayToken(token: string) {
  const r = await apiFetch<{ id?: string; name?: string; phone?: string }>(`${BASE()}/users/profile`, {
    headers: { Authorization: `Bearer ${token}` },
    label: "WhatsApp gateway",
  });
  return { externalId: r.phone || r.id || "whatsapp", name: r.name || r.phone || "WhatsApp number" };
}
