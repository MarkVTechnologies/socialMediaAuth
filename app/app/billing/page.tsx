import { redirect } from "next/navigation";
import { get } from "@/lib/db";
import { activatePlan, paystackConfigured, startCheckout, type Interval } from "@/lib/billing";
import { appUrl } from "@/lib/notify";
import { PLANS, formatNaira } from "@/lib/plans";
import { can, getUsage, requireRole, requireWorkspace } from "@/lib/workspace";
import { formatInZone } from "@/lib/time";
import { Alert, Badge, Meter, PageHeader } from "@/components/ui";
import type { PlanId } from "@/lib/types";

export const metadata = { title: "Billing" };

async function checkout(form: FormData) {
  "use server";
  const ctx = await requireRole(can.manageBilling);
  const plan = String(form.get("plan")) as PlanId;
  const interval = (form.get("interval") === "yearly" ? "yearly" : "monthly") as Interval;
  if (!(plan in PLANS) || plan === "trial") return;
  if (!paystackConfigured()) {
    if (process.env.NODE_ENV === "production") redirect("/app/billing?error=Payments+are+not+configured");
    // Development: activate directly so plan limits can be tested.
    activatePlan(ctx.workspace.id, plan, interval, "dev", null);
    redirect("/app/billing?success=1");
  }
  const url = await startCheckout({
    workspaceId: ctx.workspace.id,
    email: ctx.user.email,
    plan,
    interval,
    callbackUrl: `${appUrl()}/app/billing?success=1`,
  });
  redirect(url);
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string; interval?: string }> }) {
  const { workspace, role } = await requireWorkspace();
  const sp = await searchParams;
  const interval: Interval = sp.interval === "yearly" ? "yearly" : "monthly";
  const usage = getUsage(workspace.id);
  const current = PLANS[workspace.plan];
  const sub = get<{ plan: string; interval: string; provider: string; status: string; renewal_date: string | null }>(
    "SELECT * FROM subscriptions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1",
    workspace.id,
  );
  const owner = can.manageBilling(role);

  return (
    <>
      <PageHeader title="Billing" description="Pay in Naira by card, bank transfer or USSD via Paystack." />
      <div className="mb-4 space-y-2">
        {sp.success && <Alert tone="ok">Thank you! Your plan will update as soon as Paystack confirms the payment.</Alert>}
        {sp.error && <Alert tone="danger">{sp.error}</Alert>}
        {workspace.plan_status !== "active" && (
          <Alert tone="danger">Your last payment failed. Scheduled posts are paused (not deleted) until billing is updated.</Alert>
        )}
        {!paystackConfigured() && <Alert tone="warn">Paystack is not configured — plan changes apply instantly in development.</Alert>}
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <section className="card space-y-4 p-5 lg:col-span-1">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Current plan</h2>
            <Badge tone="brand">{current.name}</Badge>
          </div>
          {workspace.plan === "trial" && workspace.trial_ends_at && (
            <p className="text-sm text-muted">Trial ends {formatInZone(workspace.trial_ends_at, workspace.timezone, { dateStyle: "long", timeStyle: undefined })}</p>
          )}
          {sub && (
            <p className="text-sm text-muted">
              {sub.interval} via {sub.provider} · {sub.status}
              {sub.renewal_date ? ` · renews ${formatInZone(sub.renewal_date, workspace.timezone, { dateStyle: "medium", timeStyle: undefined })}` : ""}
            </p>
          )}
          <Meter label="Scheduled posts this month" used={usage.posts} limit={current.postsPerMonth} />
          <Meter label="AI optimisations this month" used={usage.ai} limit={current.aiPerMonth} />
          <Meter label="Connected accounts" used={usage.accounts} limit={current.accounts} />
        </section>
        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-2 font-medium">Add-ons</h2>
          <p className="text-sm text-muted">
            Extra accounts, AI credit packs and WhatsApp Broadcast message bundles are coming soon. Contact support to add them to your plan today.
          </p>
        </section>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <a href="/app/billing?interval=monthly" className={interval === "monthly" ? "btn-primary px-3 py-1.5" : "btn-secondary px-3 py-1.5"}>Monthly</a>
        <a href="/app/billing?interval=yearly" className={interval === "yearly" ? "btn-primary px-3 py-1.5" : "btn-secondary px-3 py-1.5"}>Yearly — 2 months free</a>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {(["starter", "growth", "agency"] as const).map((id) => {
          const p = PLANS[id];
          const price = interval === "yearly" ? p.yearlyPriceNgn : p.priceNgn;
          const isCurrent = workspace.plan === id;
          return (
            <div key={id} className={`card flex flex-col p-5 ${id === "growth" ? "border-brand" : ""}`}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{p.name}</h3>
                {id === "growth" && <Badge tone="brand">Popular</Badge>}
              </div>
              <p className="mt-2 text-3xl font-semibold">
                {formatNaira(price)}
                <span className="text-sm font-normal text-muted">/{interval === "yearly" ? "year" : "month"}</span>
              </p>
              <p className="mt-1 text-sm text-muted">{p.bestFor}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                <li>{p.accounts} connected accounts</li>
                <li>{p.postsPerMonth === Infinity ? "Unlimited scheduling" : `${p.postsPerMonth} posts / month`}</li>
                <li>{p.aiPerMonth.toLocaleString()} AI optimisations / month</li>
                <li>{p.storageGb} GB media storage</li>
                {p.workspaces > 1 && <li>{p.workspaces} workspaces</li>}
                {p.approvals && <li>Approval workflow{id === "agency" ? " + client links" : ""}</li>}
                {p.analytics && <li>Analytics</li>}
                {p.pdfReports && <li>Monthly PDF reports</li>}
              </ul>
              {owner ? (
                <form action={checkout} className="mt-5">
                  <input type="hidden" name="plan" value={id} />
                  <input type="hidden" name="interval" value={interval} />
                  <button className={isCurrent ? "btn-secondary w-full" : "btn-primary w-full"} disabled={isCurrent && workspace.plan_status === "active"}>
                    {isCurrent ? (workspace.plan_status === "active" ? "Current plan" : "Pay now") : `Choose ${p.name}`}
                  </button>
                </form>
              ) : (
                <p className="mt-5 text-center text-xs text-muted">Only the workspace owner can change plans.</p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
