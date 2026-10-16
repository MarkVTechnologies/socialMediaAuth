import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: `${APP_NAME} — Social media on autopilot`, template: `%s · ${APP_NAME}` },
  description:
    "Write once, publish everywhere. AI-optimised scheduling for Facebook, Instagram, WhatsApp, TikTok, YouTube and LinkedIn — priced in Naira.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
