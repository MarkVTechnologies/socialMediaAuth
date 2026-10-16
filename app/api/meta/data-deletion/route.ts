import crypto from "node:crypto";
import { all, run } from "@/lib/db";
import { audit, appUrl } from "@/lib/notify";
import { randomToken } from "@/lib/crypto";

/**
 * Meta data deletion callback (required for App Review).
 * Meta POSTs `signed_request`; we delete tokens for accounts tied to that Meta user
 * and return a status URL + confirmation code.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const signed = String(form.get("signed_request") || "");
  const [sig, payload] = signed.split(".");
  const secret = process.env.META_APP_SECRET;
  if (!sig || !payload || !secret) return Response.json({ error: "invalid request" }, { status: 400 });

  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (expected !== sig) return Response.json({ error: "bad signature" }, { status: 400 });
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { user_id: string };

  // We store Page/IG IDs, not the Meta user ID; match on the meta_json userId when present.
  const accounts = all<{ id: string; workspace_id: string }>(
    "SELECT id, workspace_id FROM social_accounts WHERE platform IN ('facebook','instagram') AND json_extract(meta_json, '$.metaUserId') = ?",
    data.user_id,
  );
  for (const a of accounts) run("DELETE FROM social_accounts WHERE id = ?", a.id);

  const code = randomToken(12);
  audit("meta.data_deletion", { target: code, details: { accounts: accounts.length } });
  return Response.json({ url: `${appUrl()}/data-deletion?code=${code}`, confirmation_code: code });
}
