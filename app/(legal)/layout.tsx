import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-muted">← {APP_NAME}</Link>
      <article className="mt-6 space-y-4 text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-medium [&_ul]:list-disc [&_ul]:pl-5">
        <p className="rounded-lg bg-warn-soft p-3 text-warn">Draft for legal review — not yet final.</p>
        {children}
      </article>
    </div>
  );
}
