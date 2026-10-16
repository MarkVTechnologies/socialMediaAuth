import { all, parseJson } from "@/lib/db";
import { getPost, getVariants, getWorkspaceAccounts, postHistory, DEFAULT_BEST_TIMES } from "@/lib/posts";
import { can, requireWorkspace } from "@/lib/workspace";
import { utcToZonedLocal } from "@/lib/time";
import { PLATFORMS } from "@/lib/platforms";
import { aiConfigured } from "@/lib/ai";
import { flagEnabled } from "@/lib/flags";
import { Composer, type ComposerAccount, type ComposerMedia, type ComposerInitial } from "./Composer";
import type { MediaAsset } from "@/lib/types";

export const metadata = { title: "Compose" };

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ post?: string; date?: string }> }) {
  const { workspace, role, brand } = await requireWorkspace();
  const { post: postId, date } = await searchParams;

  const accounts: ComposerAccount[] = getWorkspaceAccounts(workspace.id).map((a) => ({
    id: a.id,
    platform: a.platform,
    name: a.name,
    avatarUrl: a.avatar_url,
    status: a.status,
    demo: a.connection_type === "demo",
  }));
  const media: ComposerMedia[] = all<MediaAsset>(
    "SELECT * FROM media_assets WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 200",
    workspace.id,
  ).map((m) => ({
    id: m.id,
    filename: m.filename,
    type: m.type,
    mime: m.mime,
    url: `/media/${m.storage_key}`,
    width: m.width,
    height: m.height,
    duration: m.duration,
    size: m.size,
    folder: m.folder,
    tags: m.tags,
  }));

  const post = postId ? getPost(workspace.id, postId) : undefined;
  let initial: ComposerInitial = {
    postId: null,
    masterText: "",
    hint: "",
    language: brand.languages?.[0] ?? "en-NG",
    mediaIds: [],
    variants: [],
    status: "draft",
    scheduledLocal: date ? `${date}T09:00` : "",
    recurrence: "",
    publishedVariants: [],
  };
  let history = null;
  if (post) {
    const variants = getVariants(post.id);
    initial = {
      postId: post.id,
      masterText: post.master_text,
      hint: post.hint,
      language: post.language,
      mediaIds: parseJson<string[]>(post.media_ids, []),
      variants: variants.map((v) => ({
        accountId: v.social_account_id,
        text: v.text,
        title: v.title,
        tags: v.tags,
        settings: parseJson(v.settings_json, {}),
        locked: Boolean(v.locked),
        aiGenerated: Boolean(v.ai_generated),
      })),
      status: post.status,
      scheduledLocal: post.scheduled_at ? utcToZonedLocal(post.scheduled_at, workspace.timezone) : "",
      recurrence: post.recurrence ?? "",
      publishedVariants: variants.map((v) => ({
        id: v.id,
        accountId: v.social_account_id,
        status: v.status,
        url: v.published_url,
        error: v.error_message,
      })),
    };
    history = postHistory(post.id);
  }

  const bestTimes = Object.fromEntries(Object.keys(PLATFORMS).map((p) => [p, DEFAULT_BEST_TIMES[p as keyof typeof DEFAULT_BEST_TIMES]]));

  return (
    <Composer
      key={post?.id ?? "new"}
      accounts={accounts}
      media={media}
      initial={initial}
      timezone={workspace.timezone}
      canSchedule={can.schedule(role) && !(workspace.require_approval && !can.approve(role))}
      aiEnabled={aiConfigured()}
      tiktokDirect={flagEnabled("tiktok_direct_post")}
      bestTimes={bestTimes}
      history={history}
    />
  );
}
