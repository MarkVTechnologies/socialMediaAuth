import { getWorkspaceAccounts } from "@/lib/posts";
import { PLATFORM_LIST } from "@/lib/platforms";
import { isConfigured } from "@/lib/publishers";
import { flagEnabled } from "@/lib/flags";
import { can, getUsage, requireWorkspace } from "@/lib/workspace";
import { PLANS } from "@/lib/plans";
import { formatInZone } from "@/lib/time";
import { Alert, Badge, PageHeader, PlatformIcon, StatusBadge } from "@/components/ui";
import { WHATSAPP_STATUS_DAILY_CAP } from "@/lib/publishers/whatsapp";
import { connectDemo, connectWhatsAppStatus, disconnectAccount } from "./actions";

export const metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { workspace, role } = await requireWorkspace();
  const { error, connected } = await searchParams;
  const accounts = getWorkspaceAccounts(workspace.id);
  const usage = getUsage(workspace.id);
  const manage = can.manageAccounts(role);
  const demo = flagEnabled("demo_connections");
  const waStatus = flagEnabled("whatsapp_status");
  const tiktokDirect = flagEnabled("tiktok_direct_post");

  return (
    <>
      <PageHeader
        title="Social accounts"
        description={`${usage.accounts} of ${PLANS[workspace.plan].accounts} accounts connected. We connect through each platform's official login and never ask for your passwords.`}
      />
      <div className="mb-4 space-y-2">
        {error && <Alert tone="danger">{error}</Alert>}
        {connected && Number(connected) > 0 && <Alert tone="ok">Connected {connected} account(s).</Alert>}
      </div>

      <section className="mb-8">
        <h2 className="mb-3 font-medium">Connected</h2>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted">No accounts connected yet.</p>
        ) : (
          <div className="card divide-y divide-border">
            {accounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <PlatformIcon platform={a.platform} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{a.name}</p>
                  <p className="text-xs text-muted">
                    {a.connection_type === "demo" ? "Demo (simulated publishing)" : a.connection_type === "unofficial" ? "Unofficial gateway" : "Official API"}
                    {a.token_expires_at ? ` · token renews ${formatInZone(a.token_expires_at, workspace.timezone, { dateStyle: "medium", timeStyle: undefined })}` : ""}
                  </p>
                </div>
                <StatusBadge status={a.status} />
                {manage && a.status !== "connected" && a.connection_type === "official" && (
                  <a href={`/api/connect/${a.platform}`} className="btn-primary px-3 py-1.5">Reconnect</a>
                )}
                {manage && (
                  <form action={disconnectAccount}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="btn-secondary px-3 py-1.5">Disconnect</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-medium">Add an account</h2>
        {!manage && <p className="mb-3 text-sm text-muted">Only owners and admins can connect accounts.</p>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PLATFORM_LIST.filter((p) => p.id !== "whatsapp_status").map((p) => {
            const configured = isConfigured(p.id);
            return (
              <div key={p.id} className="card flex flex-col p-5">
                <div className="mb-2 flex items-center gap-3">
                  <PlatformIcon platform={p.id} size={32} />
                  <p className="font-medium">{p.name}</p>
                  {p.id === "tiktok" && <Badge tone="warn">{tiktokDirect ? "Direct Post" : "Inbox mode"}</Badge>}
                </div>
                <p className="flex-1 text-sm text-muted">{p.description}</p>
                {manage && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {configured ? (
                      <a href={`/api/connect/${p.id}`} className="btn-primary">Connect</a>
                    ) : (
                      <span className="text-xs text-muted">Official app credentials not configured on this server.</span>
                    )}
                    {demo && (
                      <form action={connectDemo}>
                        <input type="hidden" name="platform" value={p.id} />
                        <button className="btn-secondary">Add demo account</button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="card flex flex-col border-warn/40 p-5 md:col-span-2 xl:col-span-3">
            <div className="mb-2 flex items-center gap-3">
              <PlatformIcon platform="whatsapp_status" size={32} />
              <p className="font-medium">WhatsApp Status autopost</p>
              <Badge tone="warn">Unofficial · opt-in</Badge>
            </div>
            {!waStatus ? (
              <p className="text-sm text-muted">
                Coming soon. WhatsApp Broadcast (official API) and Status autopost are part of the next release.
              </p>
            ) : (
              manage && (
                <form action={connectWhatsAppStatus} className="space-y-3">
                  <Alert tone="warn">
                    <b>Risk notice.</b> Meta&apos;s official WhatsApp API does not support posting to Status. This feature uses an
                    unofficial linked-device gateway. WhatsApp may restrict or ban numbers that use unofficial tools. We strongly
                    recommend a <b>secondary business number</b>. We cap Status posts at {WHATSAPP_STATUS_DAILY_CAP} per day to reduce
                    risk, but we cannot guarantee your number will not be banned.
                  </Alert>
                  <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                    <li>Create a channel in your gateway dashboard (e.g. Whapi.Cloud) and scan its QR code with WhatsApp → Linked devices.</li>
                    <li>Copy the channel API token and paste it below.</li>
                  </ol>
                  <input name="token" className="field max-w-md" placeholder="Gateway API token" autoComplete="off" />
                  {!demo ? null : (
                    <p className="text-xs text-muted">Tip: you can also add a demo WhatsApp account to try the flow safely.</p>
                  )}
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="accept_risk" className="mt-1" />
                    I understand the risk and accept responsibility for using an unofficial connection with this number.
                  </label>
                  <div className="flex gap-2">
                    <button className="btn-primary">Connect WhatsApp Status</button>
                  </div>
                </form>
              )
            )}
            {demo && manage && (
              <form action={connectDemo} className="mt-3">
                <input type="hidden" name="platform" value="whatsapp_status" />
                <button className="btn-secondary">Add demo WhatsApp account</button>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
