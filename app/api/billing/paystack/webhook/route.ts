import { handlePaystackEvent, verifyPaystackSignature } from "@/lib/billing";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyPaystackSignature(raw, req.headers.get("x-paystack-signature"))) {
    return new Response("Invalid signature", { status: 401 });
  }
  try {
    await handlePaystackEvent(JSON.parse(raw));
  } catch (e) {
    console.error("[paystack]", e);
    return new Response("Error", { status: 500 }); // Paystack retries
  }
  return new Response("ok");
}
