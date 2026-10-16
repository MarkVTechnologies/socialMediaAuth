import Link from "next/link";
import { Calendar, Languages, MessageCircle, RefreshCw, Sparkles, Wallet } from "lucide-react";
import { APP_NAME, COMPANY } from "@/lib/brand";
import { PLANS, formatNaira } from "@/lib/plans";
import { PLATFORM_LIST } from "@/lib/platforms";
import { PlatformIcon } from "@/components/ui";

const FEATURES = [
  { icon: Sparkles, title: "Write once, publish everywhere", body: "One upload and one draft becomes platform-ready posts for every channel you use." },
  { icon: Languages, title: "AI that speaks Naija", body: "Captions tuned for each platform's search — in Nigerian English or Pidgin, in your brand's voice." },
  { icon: Calendar, title: "Set and forget", body: "A content calendar that publishes on time, retries if something fails, and tells you in plain language when to act." },
  { icon: MessageCircle, title: "WhatsApp-first", body: "Built for how Nigerian businesses actually sell — Status, Channels and Broadcast (coming soon)." },
  { icon: Wallet, title: "Priced in Naira", body: "Pay with card, bank transfer or USSD through Paystack. No dollar surprises." },
  { icon: RefreshCw, title: "Teams & agencies", body: "Roles, approvals and client approval links. Manage many brands from one dashboard." },
];

export default function Landing() {
  return (
    <div>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        <nav className="flex items-center gap-2">
          <Link href="/login" className="btn-secondary">Sign in</Link>
          <Link href="/signup" className="btn-primary">Start free trial</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 text-center sm:pt-20">
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Post to every platform in minutes, not hours.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">
          {APP_NAME} rewrites your post for Facebook, Instagram, TikTok, YouTube, LinkedIn and WhatsApp — then publishes it
          automatically at the right time.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/signup" className="btn-primary px-6 py-3 text-base">Try it free for 14 days</Link>
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          {PLATFORM_LIST.map((p) => (
            <span key={p.id} className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm">
              <PlatformIcon platform={p.id} size={20} /> {p.name}
            </span>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="card p-6">
            <Icon className="mb-3 text-brand" />
            <h3 className="font-medium">{title}</h3>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24">
        <h2 className="mb-6 text-center text-2xl font-semibold">Simple Naira pricing</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(["starter", "growth", "agency"] as const).map((id) => {
            const p = PLANS[id];
            return (
              <div key={id} className={`card p-6 ${id === "growth" ? "border-brand" : ""}`}>
                <h3 className="font-semibold">{p.name}</h3>
                <p className="mt-2 text-3xl font-semibold">{formatNaira(p.priceNgn)}<span className="text-sm font-normal text-muted">/month</span></p>
                <p className="mt-1 text-sm text-muted">{p.bestFor}</p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  <li>{p.accounts} accounts</li>
                  <li>{p.postsPerMonth === Infinity ? "Unlimited scheduling" : `${p.postsPerMonth} posts / month`}</li>
                  <li>{p.aiPerMonth.toLocaleString()} AI optimisations</li>
                  <li>{p.storageGb} GB storage</li>
                </ul>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-center text-sm text-muted">Pay yearly and get about two months free.</p>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted">
        © {new Date().getFullYear()} {COMPANY} ·{" "}
        <Link href="/privacy" className="hover:text-text">Privacy</Link> ·{" "}
        <Link href="/terms" className="hover:text-text">Terms</Link> ·{" "}
        <Link href="/data-deletion" className="hover:text-text">Data deletion</Link>
      </footer>
    </div>
  );
}
