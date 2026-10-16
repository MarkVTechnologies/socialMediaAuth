import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8 text-xl font-semibold tracking-tight">
        {APP_NAME}
      </Link>
      <div className="card w-full max-w-sm p-6">{children}</div>
    </div>
  );
}
