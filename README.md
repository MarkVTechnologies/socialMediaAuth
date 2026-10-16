# Postwise — Social Media Automation Platform

Phase 1 MVP of the Mark V Technologies spec (*Social_Media_Automation_Platform_Spec.docx*): write once, AI-optimise per platform, schedule, and auto-publish to Facebook, Instagram, LinkedIn, YouTube, TikTok and WhatsApp Status. The product name is a placeholder; set it with `NEXT_PUBLIC_APP_NAME`.

## Run it

Requires Node 22+ (uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env.local   # everything is optional in dev
npm run dev                  # http://localhost:3000
```

The first user to sign up becomes the platform admin (`/admin`). Without platform credentials, use **Accounts → Add demo account** to try the whole flow with simulated publishing. In a demo post, `#failtemp` simulates a temporary failure and `#failperm` a permanent one.

## Architecture

| Area | Where |
|---|---|
| Next.js 16 App Router: UI, server actions, OAuth callbacks, webhooks | `app/` |
| Data layer: SQLite via `node:sqlite`, schema in one place | `lib/db.ts` |
| Auth (scrypt passwords, DB sessions, Google sign-in), roles | `lib/auth.ts`, `lib/workspace.ts` |
| AI engine: Claude with structured JSON output, guardrails, offline fallback | `lib/ai.ts` |
| Publisher adapters: same interface for every platform (PRD §6.3) | `lib/publishers/*` |
| Scheduler and worker: DB job queue, retries after 1/5/15 min, alerts, recurrence, token refresh, metrics sync | `lib/scheduler.ts`, `instrumentation.ts` |
| Media storage, probing and per-platform validation | `lib/media.ts`, `lib/validation.ts` |
| Paystack billing, plan limits | `lib/billing.ts`, `lib/plans.ts` |

Tokens are encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`, required in production). All sensitive actions are written to `audit_logs`.

### The worker

The publisher runs inside the Next.js server process (started in `instrumentation.ts`) and checks for due jobs every 15 seconds. It needs a long-running host such as a VPS or Railway. On serverless hosting, set `WORKER_ENABLED=false` and call `GET /api/cron/tick` every minute with `Authorization: Bearer $CRON_SECRET`.

## Known gaps / next steps

- **Platform approvals:** the Meta, Google, LinkedIn and TikTok adapters are written against the official APIs but have not been tested against live apps. Each needs app credentials and review. TikTok stays in inbox mode until the `tiktok_direct_post` flag is turned on.
- **WhatsApp Status:** the gateway endpoints follow Whapi.Cloud's API; check them against the gateway's current docs before turning on the `whatsapp_status` flag. WhatsApp Broadcast (official API) is Phase 2.
- **Storage and scale:** media is stored on local disk. Move it to R2/S3 behind `putObject`/`readObject`, and move the database to Postgres before running multiple instances.
- No FFmpeg transcoding, resumable uploads, Flutterwave, add-ons, 2FA, or Yoruba/Hausa/Igbo copy yet.
- Legal pages are drafts and need review by a lawyer.
