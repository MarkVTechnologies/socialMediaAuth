"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Eye, Link2, Lock, Pencil, Sparkles, Trash2, Unlock } from "lucide-react";
import { PLATFORMS, LANGUAGES } from "@/lib/platforms";
import { validateForPlatform } from "@/lib/validation";
import type { MediaAsset, Platform } from "@/lib/types";
import type { VariantInput } from "@/lib/posts";
import { Alert, Badge, PlatformIcon, StatusBadge } from "@/components/ui";
import {
  createApprovalLinkAction,
  deletePostAction,
  optimiseAction,
  retryVariantAction,
  saveDraftAction,
  submitAction,
} from "./actions";

export interface ComposerAccount {
  id: string;
  platform: Platform;
  name: string;
  avatarUrl: string | null;
  status: string;
  demo: boolean;
}

export interface ComposerMedia {
  id: string;
  filename: string;
  type: "image" | "video";
  mime: string;
  url: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  size: number;
  folder: string;
  tags: string;
}

export interface ComposerInitial {
  postId: string | null;
  masterText: string;
  hint: string;
  language: string;
  mediaIds: string[];
  variants: VariantInput[];
  status: string;
  scheduledLocal: string;
  recurrence: string;
  publishedVariants: { id: string; accountId: string; status: string; url: string | null; error: string | null }[];
}

interface Props {
  accounts: ComposerAccount[];
  media: ComposerMedia[];
  initial: ComposerInitial;
  timezone: string;
  canSchedule: boolean;
  aiEnabled: boolean;
  tiktokDirect: boolean;
  bestTimes: Record<string, string>;
  history: {
    approvals: { approver: string; decision: string; comment: string; created_at: string }[];
    logs: { action: string; actor_name: string | null; created_at: string }[];
  } | null;
}

export function Composer({ accounts, media, initial, timezone, canSchedule, aiEnabled, tiktokDirect, bestTimes, history }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [postId, setPostId] = useState(initial.postId);
  const [masterText, setMasterText] = useState(initial.masterText);
  const [hint, setHint] = useState(initial.hint);
  const [language, setLanguage] = useState(initial.language);
  const [mediaIds, setMediaIds] = useState<string[]>(initial.mediaIds);
  const [variants, setVariants] = useState<Record<string, VariantInput>>(
    Object.fromEntries(initial.variants.map((v) => [v.accountId, v])),
  );
  const [scheduledLocal, setScheduledLocal] = useState(initial.scheduledLocal);
  const [recurrence, setRecurrence] = useState(initial.recurrence);
  const [mode, setMode] = useState<Record<string, "edit" | "preview">>({});
  const [flags, setFlags] = useState<{ severity: string; message: string }[]>([]);
  const [notes, setNotes] = useState<Partial<Record<Platform, string>>>({});
  const [feedback, setFeedback] = useState<{ tone: "ok" | "danger" | "warn"; text: string } | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);

  const selectedMedia = mediaIds.map((id) => media.find((m) => m.id === id)).filter((m): m is ComposerMedia => Boolean(m));
  const selectedAccounts = accounts.filter((a) => variants[a.id]);
  const readOnly = initial.status === "published";

  const payload = () => ({
    postId,
    masterText,
    hint,
    language,
    mediaIds,
    recurrence: recurrence || null,
    variants: Object.values(variants),
  });

  function toggleAccount(a: ComposerAccount) {
    setVariants((prev) => {
      const next = { ...prev };
      if (next[a.id]) delete next[a.id];
      else {
        // Copy an existing version for the same platform, else the master draft.
        const sibling = Object.values(prev).find((v) => accounts.find((x) => x.id === v.accountId)?.platform === a.platform);
        next[a.id] = sibling
          ? { ...sibling, accountId: a.id }
          : { accountId: a.id, text: masterText, title: null, tags: null, settings: {}, locked: false, aiGenerated: false };
      }
      return next;
    });
  }

  function updateVariant(accountId: string, patch: Partial<VariantInput>) {
    setVariants((prev) => ({ ...prev, [accountId]: { ...prev[accountId], ...patch } }));
  }
  function updateSetting(accountId: string, key: string, value: unknown) {
    setVariants((prev) => ({
      ...prev,
      [accountId]: { ...prev[accountId], settings: { ...(prev[accountId].settings ?? {}), [key]: value } },
    }));
  }

  function run(fn: () => Promise<void>) {
    setFeedback(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        setFeedback({ tone: "danger", text: (e as Error).message });
      }
    });
  }

  const onOptimise = () =>
    run(async () => {
      const r = await optimiseAction(payload());
      if (!r.ok) return setFeedback({ tone: "danger", text: r.error! });
      setPostId(r.postId!);
      setVariants(Object.fromEntries(r.variants!.map((v) => [v.accountId, v])));
      setFlags(r.flags ?? []);
      setNotes(r.notes ?? {});
      setFeedback({
        tone: r.offline ? "warn" : "ok",
        text: r.offline
          ? "Offline mode: basic formatting applied. Add an ANTHROPIC_API_KEY for full AI optimisation."
          : "Optimised for each platform. Review and edit before scheduling.",
      });
      if (!postId) router.replace(`/app/compose?post=${r.postId}`, { scroll: false });
    });

  const onSave = () =>
    run(async () => {
      const r = await saveDraftAction(payload());
      if (!r.ok) return setFeedback({ tone: "danger", text: r.error! });
      setPostId(r.postId!);
      setFeedback({ tone: "ok", text: "Draft saved." });
      if (!postId) router.replace(`/app/compose?post=${r.postId}`, { scroll: false });
    });

  const onSubmit = (m: "now" | "schedule" | "queue") =>
    run(async () => {
      const r = await submitAction(payload(), m, scheduledLocal);
      if (!r.ok) return setFeedback({ tone: "danger", text: r.error! });
      setFeedback({ tone: "ok", text: r.message ?? "Done" });
      router.push(r.status === "pending_approval" ? "/app/approvals" : "/app/calendar");
    });

  const onDelete = () =>
    run(async () => {
      if (!postId) return;
      const r = await deletePostAction(postId);
      if (!r.ok) return setFeedback({ tone: "danger", text: r.error! });
      router.push("/app/posts");
    });

  const onApprovalLink = () =>
    run(async () => {
      const saved = postId ? { ok: true, postId } : await saveDraftAction(payload());
      if (!saved.postId) return;
      setPostId(saved.postId);
      const r = await createApprovalLinkAction(saved.postId);
      if (!r.ok) return setFeedback({ tone: "danger", text: r.error! });
      setApprovalUrl(r.url!);
      await navigator.clipboard?.writeText(r.url!).catch(() => undefined);
    });

  const issuesByPlatform = useMemo(() => {
    const assets = selectedMedia as unknown as MediaAsset[];
    const out: Partial<Record<Platform, ReturnType<typeof validateForPlatform>>> = {};
    for (const a of selectedAccounts) out[a.platform] = validateForPlatform(a.platform, assets);
    return out;
  }, [selectedMedia, selectedAccounts]);

  const grouped = useMemo(() => {
    const g: Partial<Record<Platform, ComposerAccount[]>> = {};
    for (const a of accounts) (g[a.platform] ??= []).push(a);
    return g;
  }, [accounts]);

  return (
    <div className="pb-28">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{postId ? "Edit post" : "New post"}</h1>
        {postId && <StatusBadge status={initial.status} />}
        <div className="flex-1" />
        {postId && !readOnly && (
          <button onClick={onDelete} className="btn-danger" disabled={pending}>
            <Trash2 size={16} /> Delete
          </button>
        )}
      </div>

      {feedback && (
        <div className="mb-4">
          <Alert tone={feedback.tone}>{feedback.text}</Alert>
        </div>
      )}
      {flags.length > 0 && (
        <div className="mb-4 space-y-2">
          {flags.map((f, i) => (
            <Alert key={i} tone={f.severity === "block" ? "danger" : "warn"}>
              <b>Policy check:</b> {f.message}
            </Alert>
          ))}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Left: master draft */}
        <div className="space-y-5">
          <section className="card p-5">
            <label className="label" htmlFor="master">Master draft</label>
            <textarea
              id="master"
              className="field min-h-40"
              placeholder="Write your post once. We'll tailor it for each platform."
              value={masterText}
              onChange={(e) => setMasterText(e.target.value)}
              disabled={readOnly}
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="hint">Hint for the AI (optional)</label>
                <input
                  id="hint"
                  className="field"
                  placeholder="e.g. focus on the Christmas discount"
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="lang">Language</label>
                <select id="lang" className="field" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">Media</h2>
              <button className="btn-secondary px-3 py-1.5" onClick={() => setShowLibrary((s) => !s)} disabled={readOnly}>
                {showLibrary ? "Done" : "Add from library"}
              </button>
            </div>
            {selectedMedia.length === 0 && !showLibrary && <p className="text-sm text-muted">No media attached — text-only post.</p>}
            <div className="flex flex-wrap gap-2">
              {selectedMedia.map((m, i) => (
                <div key={m.id} className="relative">
                  <Thumb m={m} />
                  {!readOnly && (
                    <button
                      className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-text text-xs text-bg"
                      onClick={() => setMediaIds((ids) => ids.filter((x) => x !== m.id))}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  )}
                  {i === 0 && selectedMedia.length > 1 && <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">1st</span>}
                </div>
              ))}
            </div>
            {showLibrary && (
              <div className="mt-4 grid max-h-72 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                {media.length === 0 && (
                  <p className="col-span-full text-sm text-muted">
                    Your library is empty. <a href="/app/media" className="text-brand">Upload media</a>.
                  </p>
                )}
                {media.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMediaIds((ids) => (ids.includes(m.id) ? ids.filter((x) => x !== m.id) : [...ids, m.id]))}
                    className={clsx("rounded-lg ring-2", mediaIds.includes(m.id) ? "ring-brand" : "ring-transparent")}
                  >
                    <Thumb m={m} />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-medium">Publish to</h2>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted">
                No accounts connected. <a href="/app/accounts" className="text-brand">Connect an account</a> first.
              </p>
            ) : (
              <div className="space-y-3">
                {(Object.keys(grouped) as Platform[]).map((p) => (
                  <div key={p}>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">{PLATFORMS[p].name}</p>
                    <div className="flex flex-wrap gap-2">
                      {grouped[p]!.map((a) => (
                        <button
                          key={a.id}
                          disabled={readOnly}
                          onClick={() => toggleAccount(a)}
                          className={clsx(
                            "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
                            variants[a.id] ? "border-brand bg-brand-soft text-brand" : "border-border hover:bg-surface-2",
                          )}
                        >
                          <PlatformIcon platform={a.platform} size={18} />
                          {a.name}
                          {a.demo && <Badge>demo</Badge>}
                          {a.status !== "connected" && <Badge tone="danger">{a.status}</Badge>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              className="btn-primary mt-5 w-full"
              onClick={onOptimise}
              disabled={pending || readOnly || selectedAccounts.length === 0 || !masterText.trim()}
            >
              <Sparkles size={16} /> {pending ? "Working…" : aiEnabled ? "Optimise for each platform" : "Optimise (offline mode)"}
            </button>
          </section>

          {history && (history.logs.length > 0 || history.approvals.length > 0) && (
            <section className="card p-5">
              <h2 className="mb-3 font-medium">History</h2>
              <ul className="space-y-1.5 text-sm text-muted">
                {[...history.logs.map((l) => ({ t: l.created_at, s: `${l.action.replace("post.", "").replace(/_/g, " ")}${l.actor_name ? ` by ${l.actor_name}` : ""}` })),
                  ...history.approvals.map((a) => ({ t: a.created_at, s: `${a.decision} by ${a.approver}${a.comment ? ` — “${a.comment}”` : ""}` }))]
                  .sort((a, b) => a.t.localeCompare(b.t))
                  .map((e, i) => (
                    <li key={i}>
                      <span className="tabular-nums">{new Date(e.t).toLocaleString("en-NG", { timeZone: timezone, dateStyle: "short", timeStyle: "short" })}</span> · {e.s}
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </div>

        {/* Right: per-platform versions */}
        <div className="space-y-4">
          {selectedAccounts.length === 0 && (
            <div className="card p-8 text-center text-sm text-muted">Select accounts to see a tailored version for each platform.</div>
          )}
          {selectedAccounts.map((a) => {
            const v = variants[a.id];
            const rules = PLATFORMS[a.platform];
            const issues = issuesByPlatform[a.platform] ?? [];
            const published = initial.publishedVariants.find((p) => p.accountId === a.id);
            const m = mode[a.id] ?? "edit";
            const over = v.text.length > rules.maxChars;
            return (
              <section key={a.id} className="card overflow-hidden">
                <header className="flex items-center gap-3 border-b border-border px-4 py-3">
                  <PlatformIcon platform={a.platform} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted">
                      {rules.name}
                      {v.aiGenerated ? " · AI-optimised" : ""}
                      {notes[a.platform] ? ` · ${notes[a.platform]}` : ""}
                    </p>
                  </div>
                  {published && published.status !== "draft" && <StatusBadge status={published.status} />}
                  <div className="flex rounded-lg border border-border text-xs">
                    <button
                      className={clsx("flex items-center gap-1 px-2 py-1", m === "edit" && "bg-surface-2")}
                      onClick={() => setMode((s) => ({ ...s, [a.id]: "edit" }))}
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      className={clsx("flex items-center gap-1 px-2 py-1", m === "preview" && "bg-surface-2")}
                      onClick={() => setMode((s) => ({ ...s, [a.id]: "preview" }))}
                    >
                      <Eye size={12} /> Preview
                    </button>
                  </div>
                  <button
                    title={v.locked ? "Locked: AI won't change this version" : "Lock this version"}
                    className={clsx("rounded-lg p-1.5", v.locked ? "bg-warn-soft text-warn" : "text-muted hover:bg-surface-2")}
                    onClick={() => updateVariant(a.id, { locked: !v.locked })}
                  >
                    {v.locked ? <Lock size={15} /> : <Unlock size={15} />}
                  </button>
                </header>

                <div className="space-y-3 p-4">
                  {published?.error && (
                    <Alert tone={published.status === "failed" ? "danger" : "warn"}>
                      {published.error}
                      {published.status === "failed" && (
                        <span className="ml-2 inline-flex gap-2">
                          {/expired|reconnect|permission/i.test(published.error) ? (
                            <a href="/app/accounts" className="font-medium underline">Reconnect account</a>
                          ) : null}
                          <button
                            className="font-medium underline"
                            onClick={() => run(async () => {
                              const r = await retryVariantAction(published.id);
                              setFeedback({ tone: r.ok ? "ok" : "danger", text: r.message ?? r.error ?? "" });
                              router.refresh();
                            })}
                          >
                            Retry
                          </button>
                        </span>
                      )}
                    </Alert>
                  )}
                  {published?.url && (
                    <a href={published.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand">
                      <Link2 size={14} /> View published post
                    </a>
                  )}
                  {issues.map((i, idx) => (
                    <Alert key={idx} tone={i.level === "error" ? "danger" : "warn"}>{i.message}</Alert>
                  ))}

                  {m === "preview" ? (
                    <Preview platform={a.platform} name={a.name} avatar={a.avatarUrl} text={v.text} title={v.title} media={selectedMedia} />
                  ) : (
                    <>
                      {a.platform === "youtube" && (
                        <div>
                          <label className="label">Title</label>
                          <input
                            className="field"
                            maxLength={100}
                            value={v.title ?? ""}
                            onChange={(e) => updateVariant(a.id, { title: e.target.value })}
                          />
                          <p className={clsx("mt-1 text-xs", (v.title?.length ?? 0) > 70 ? "text-warn" : "text-muted")}>
                            {v.title?.length ?? 0}/70 recommended
                          </p>
                        </div>
                      )}
                      <div>
                        <label className="label">{a.platform === "youtube" ? "Description" : "Caption"}</label>
                        <textarea
                          className={clsx("field min-h-32", over && "border-danger")}
                          value={v.text}
                          onChange={(e) => updateVariant(a.id, { text: e.target.value, aiGenerated: false })}
                        />
                        <p className={clsx("mt-1 text-right text-xs tabular-nums", over ? "text-danger" : "text-muted")}>
                          {v.text.length.toLocaleString()} / {rules.maxChars.toLocaleString()}
                        </p>
                      </div>
                      <PlatformFields
                        platform={a.platform}
                        variant={v}
                        tiktokDirect={tiktokDirect}
                        onVariant={(patch) => updateVariant(a.id, patch)}
                        onSetting={(k, val) => updateSetting(a.id, k, val)}
                      />
                    </>
                  )}
                  <p className="text-xs text-muted">Best time: {bestTimes[a.platform]}</p>
                </div>
              </section>
            );
          })}
          {approvalUrl && (
            <Alert tone="brand">
              Approval link copied — share it with your client (valid 14 days):{" "}
              <span className="break-all font-mono text-xs">{approvalUrl}</span>
            </Alert>
          )}
        </div>
      </div>

      {/* Sticky action bar */}
      {!readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3 sm:px-8">
            <input
              type="datetime-local"
              className="field w-auto"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
              aria-label={`Schedule time (${timezone})`}
            />
            <select className="field w-auto" value={recurrence} onChange={(e) => setRecurrence(e.target.value)} aria-label="Repeat">
              <option value="">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <span className="hidden text-xs text-muted md:inline">{timezone}</span>
            <div className="flex-1" />
            <button className="btn-secondary" onClick={onSave} disabled={pending}>Save draft</button>
            <button className="btn-secondary" onClick={onApprovalLink} disabled={pending || selectedAccounts.length === 0}>
              Client approval link
            </button>
            {canSchedule ? (
              <>
                <button className="btn-secondary" onClick={() => onSubmit("queue")} disabled={pending}>Add to queue</button>
                <button className="btn-secondary" onClick={() => onSubmit("now")} disabled={pending}>Publish now</button>
                <button className="btn-primary" onClick={() => onSubmit("schedule")} disabled={pending || !scheduledLocal}>
                  Schedule
                </button>
              </>
            ) : (
              <button className="btn-primary" onClick={() => onSubmit(scheduledLocal ? "schedule" : "now")} disabled={pending}>
                Submit for approval
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Thumb({ m }: { m: ComposerMedia }) {
  return m.type === "video" ? (
    <div className="relative h-20 w-20 overflow-hidden rounded-lg bg-black">
      <video src={m.url} className="h-full w-full object-cover" muted preload="metadata" />
      <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
        {m.duration ? `${Math.round(m.duration)}s` : "video"}
      </span>
    </div>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.url} alt={m.filename} className="h-20 w-20 rounded-lg object-cover" />
  );
}

function PlatformFields({
  platform,
  variant,
  tiktokDirect,
  onVariant,
  onSetting,
}: {
  platform: Platform;
  variant: VariantInput;
  tiktokDirect: boolean;
  onVariant: (p: Partial<VariantInput>) => void;
  onSetting: (k: string, v: unknown) => void;
}) {
  const s = (variant.settings ?? {}) as Record<string, string | boolean | undefined> & {
    visibility?: string;
    categoryId?: string;
    privacyLevel?: string;
    firstComment?: string;
    altText?: string;
    link?: string;
  };
  if (platform === "youtube")
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Tags (comma separated)</label>
          <input className="field" value={variant.tags ?? ""} onChange={(e) => onVariant({ tags: e.target.value })} />
        </div>
        <div>
          <label className="label">Visibility</label>
          <select className="field" value={s.visibility ?? "public"} onChange={(e) => onSetting("visibility", e.target.value)}>
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </div>
        <div>
          <label className="label">Category</label>
          <select className="field" value={s.categoryId ?? "22"} onChange={(e) => onSetting("categoryId", e.target.value)}>
            <option value="22">People & Blogs</option>
            <option value="29">Nonprofits & Activism</option>
            <option value="27">Education</option>
            <option value="24">Entertainment</option>
            <option value="10">Music</option>
            <option value="19">Travel & Events</option>
            <option value="28">Science & Technology</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={Boolean(s.madeForKids)} onChange={(e) => onSetting("madeForKids", e.target.checked)} />
          Made for kids
        </label>
      </div>
    );
  if (platform === "tiktok")
    return (
      <div className="space-y-3 rounded-lg bg-surface-2 p-3 text-sm">
        {!tiktokDirect ? (
          <p className="text-muted">
            Inbox mode: the video is sent to your TikTok inbox and you tap <b>Post</b> in the TikTok app to publish.
          </p>
        ) : (
          <>
            <div>
              <label className="label">Who can view</label>
              <select className="field" value={s.privacyLevel ?? ""} onChange={(e) => onSetting("privacyLevel", e.target.value)}>
                <option value="" disabled>Select privacy (required)</option>
                <option value="PUBLIC_TO_EVERYONE">Everyone</option>
                <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
                <option value="FOLLOWER_OF_CREATOR">Followers</option>
                <option value="SELF_ONLY">Only me</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-4">
              {[["disableComment", "Disable comments"], ["disableDuet", "Disable Duet"], ["disableStitch", "Disable Stitch"]].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(s[k])} onChange={(e) => onSetting(k, e.target.checked)} /> {l}
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={Boolean(s.brandedContent)} onChange={(e) => onSetting("brandedContent", e.target.checked)} />
              Branded content (paid partnership)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={Boolean(s.yourBrand)} onChange={(e) => onSetting("yourBrand", e.target.checked)} />
              Promoting your own brand
            </label>
            <p className="text-xs text-muted">
              By posting, you agree to TikTok&apos;s Music Usage Confirmation{s.brandedContent ? " and Branded Content Policy" : ""}.
            </p>
          </>
        )}
      </div>
    );
  if (platform === "facebook" || platform === "instagram")
    return (
      <div className="grid gap-3">
        <div>
          <label className="label">First comment (optional)</label>
          <input className="field" value={s.firstComment ?? ""} onChange={(e) => onSetting("firstComment", e.target.value)} placeholder="e.g. extra hashtags or a link" />
        </div>
        {platform === "instagram" && (
          <div>
            <label className="label">Alt text (accessibility)</label>
            <input className="field" value={s.altText ?? ""} onChange={(e) => onSetting("altText", e.target.value)} />
          </div>
        )}
        {platform === "facebook" && (
          <div>
            <label className="label">Link (optional, text posts only)</label>
            <input className="field" value={s.link ?? ""} onChange={(e) => onSetting("link", e.target.value)} placeholder="https://" />
          </div>
        )}
      </div>
    );
  if (platform === "whatsapp_status")
    return (
      <p className="rounded-lg bg-warn-soft p-3 text-xs text-warn">
        WhatsApp Status uses an unofficial gateway. Posts are capped per day to reduce the risk of your number being banned.
      </p>
    );
  return null;
}

function Preview({
  platform,
  name,
  avatar,
  text,
  title,
  media,
}: {
  platform: Platform;
  name: string;
  avatar: string | null;
  text: string;
  title: string | null | undefined;
  media: ComposerMedia[];
}) {
  const first = media[0];
  const vertical = platform === "tiktok" || platform === "whatsapp_status";
  const truncateAt = platform === "instagram" ? 125 : platform === "linkedin" ? 210 : platform === "facebook" ? 480 : 10_000;
  const shown = text.length > truncateAt ? text.slice(0, truncateAt) + "… more" : text;
  const mediaEl = first ? (
    first.type === "video" ? (
      <video src={first.url} controls className={clsx("w-full bg-black", vertical ? "aspect-[9/16] object-cover" : "max-h-96")} />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={first.url} alt="" className={clsx("w-full object-cover", platform === "instagram" && "aspect-square")} />
    )
  ) : null;

  if (platform === "youtube")
    return (
      <div className="mx-auto max-w-md">
        <div className="aspect-video overflow-hidden rounded-xl bg-black">{mediaEl}</div>
        <p className="mt-2 font-semibold">{title || "Untitled video"}</p>
        <p className="text-xs text-muted">{name}</p>
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-xs">{text}</p>
      </div>
    );
  if (vertical)
    return (
      <div className="relative mx-auto w-56 overflow-hidden rounded-2xl bg-black text-white">
        {mediaEl ?? <div className="flex aspect-[9/16] items-center justify-center p-4 text-center text-sm" style={{ background: "#128C7E" }}>{text}</div>}
        {mediaEl && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 p-3 text-xs">
            <p className="font-semibold">@{name}</p>
            <p className="line-clamp-3 whitespace-pre-wrap">{text}</p>
          </div>
        )}
      </div>
    );
  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 p-3">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-8 w-8 rounded-full" />
        ) : (
          <div className="h-8 w-8 rounded-full bg-surface-2" />
        )}
        <div>
          <p className="text-sm font-semibold">{name}</p>
          <p className="text-xs text-muted">Just now</p>
        </div>
      </div>
      {platform !== "instagram" && <p className="whitespace-pre-wrap px-3 pb-3 text-sm">{shown}</p>}
      {mediaEl}
      {platform === "instagram" && (
        <p className="whitespace-pre-wrap p-3 text-sm">
          <b>{name.replace(/^@/, "")}</b> {shown}
        </p>
      )}
    </div>
  );
}
