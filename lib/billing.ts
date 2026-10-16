import { get, run, now } from "./db";
import { hmacSha512, id, safeEqual } from "./crypto";
import { PLANS } from "./plans";
import { audit, notify } from "./notify";
import type { PlanId } from "./types";

/**
 * Paystack subscriptions (primary). Flutterwave can be added behind the same functions.
 * Create plans in the Paystack dashboard and put their codes in env:
 *   PAYSTACK_PLAN_STARTER_MONTHLY, PAYSTACK_PLAN_STARTER_YEARLY, PAYSTACK_PLAN_GROWTH_MONTHLY, ...
 */

export type Interval = "monthly" | "yearly";

export function paystackConfigured() {
  return Boolean(process.env.PAYSTACK_SECRET_KEY);
}

function planCode(plan: PlanId, interval: Interval) {
  return process.env[`PAYSTACK_PLAN_${plan.toUpperCase()}_${interval.toUpperCase()}`];
}

export async function startCheckout(opts: {
  workspaceId: string;
  email: string;
  plan: PlanId;
  interval: Interval;
  callbackUrl: string;
}): Promise<string> {
  const p = PLANS[opts.plan];
  const amountKobo = (opts.interval === "yearly" ? p.yearlyPriceNgn : p.priceNgn) * 100;
  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: opts.email,
      amount: amountKobo,
      currency: "NGN",
      plan: planCode(opts.plan, opts.interval),
      callback_url: opts.callbackUrl,
      channels: ["card", "bank", "ussd", "bank_transfer"],
      metadata: { workspace_id: opts.workspaceId, plan: opts.plan, interval: opts.interval },
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.status) throw new Error(body.message || "Could not start Paystack checkout");
  return body.data.authorization_url as string;
}

export function verifyPaystackSignature(rawBody: string, signature: string | null) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !signature) return false;
  return safeEqual(hmacSha512(secret, rawBody), signature);
}

export function activatePlan(workspaceId: string, plan: PlanId, interval: Interval, provider: string, ref: string | null) {
  const renewal = new Date();
  if (interval === "yearly") renewal.setFullYear(renewal.getFullYear() + 1);
  else renewal.setMonth(renewal.getMonth() + 1);
  run("UPDATE workspaces SET plan = ?, plan_status = 'active', trial_ends_at = NULL WHERE id = ?", plan, workspaceId);
  const existing = get<{ id: string }>("SELECT id FROM subscriptions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1", workspaceId);
  if (existing) {
    run(
      "UPDATE subscriptions SET plan = ?, interval = ?, provider = ?, provider_ref = COALESCE(?, provider_ref), status = 'active', renewal_date = ? WHERE id = ?",
      plan, interval, provider, ref, renewal.toISOString(), existing.id,
    );
  } else {
    run(
      "INSERT INTO subscriptions (id, workspace_id, plan, interval, provider, provider_ref, status, renewal_date, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)",
      id("sub_"), workspaceId, plan, interval, provider, ref, renewal.toISOString(), now(),
    );
  }
  audit("billing.plan_activated", { workspaceId, details: { plan, interval, provider } });
}

/** Payment failed: pause scheduled posts (not deleted) until billing is fixed. */
export async function markPastDue(workspaceId: string) {
  run("UPDATE workspaces SET plan_status = 'past_due' WHERE id = ?", workspaceId);
  run("UPDATE subscriptions SET status = 'past_due' WHERE workspace_id = ?", workspaceId);
  await notify(workspaceId, {
    title: "Payment failed — scheduled posts paused",
    body: "We couldn't renew your subscription. Your scheduled posts are paused, not deleted. Update billing to resume.",
    link: "/app/billing",
    level: "error",
    email: true,
  });
}

interface PaystackEventData {
  reference?: string;
  subscription_code?: string;
  metadata?: string | { workspace_id?: string; plan?: PlanId; interval?: Interval };
  customer?: { email?: string; customer_code?: string };
}

export async function handlePaystackEvent(event: { event: string; data?: PaystackEventData }) {
  const d: PaystackEventData = event.data ?? {};
  const meta: { workspace_id?: string; plan?: PlanId; interval?: Interval } =
    typeof d.metadata === "string" ? safeParse(d.metadata) : (d.metadata ?? {});
  let workspaceId: string | undefined = meta.workspace_id;
  if (!workspaceId && d.customer?.email) {
    workspaceId = get<{ workspace_id: string }>(
      "SELECT s.workspace_id FROM subscriptions s WHERE s.provider_ref = ?",
      d.subscription_code ?? d.customer?.customer_code ?? "",
    )?.workspace_id;
  }
  if (!workspaceId) return;

  switch (event.event) {
    case "charge.success":
      if (meta.plan) activatePlan(workspaceId, meta.plan, meta.interval ?? "monthly", "paystack", d.reference ?? null);
      else run("UPDATE workspaces SET plan_status = 'active' WHERE id = ?", workspaceId); // renewal charge
      break;
    case "subscription.create":
      run("UPDATE subscriptions SET provider_ref = ? WHERE workspace_id = ?", d.subscription_code ?? null, workspaceId);
      break;
    case "invoice.payment_failed":
      await markPastDue(workspaceId);
      break;
    case "subscription.disable":
    case "subscription.not_renew":
      run("UPDATE subscriptions SET status = 'cancelled' WHERE workspace_id = ?", workspaceId);
      break;
  }
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
