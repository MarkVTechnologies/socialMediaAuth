import { tick } from "@/lib/scheduler";
import { safeEqual } from "@/lib/crypto";

/**
 * Optional external trigger for the publisher (e.g. an uptime pinger every minute) when the
 * in-process worker is disabled (WORKER_ENABLED=false). Protected by CRON_SECRET.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  await tick();
  return Response.json({ ok: true });
}
