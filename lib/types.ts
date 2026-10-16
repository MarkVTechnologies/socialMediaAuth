export type Role = "owner" | "admin" | "editor" | "contributor" | "approver";

export type Platform =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "youtube"
  | "tiktok"
  | "whatsapp_status";

export type PostStatus =
  | "draft"
  | "pending_approval"
  | "scheduled"
  | "publishing"
  | "published"
  | "partially_published"
  | "failed";

export type VariantStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";

export type AccountStatus = "connected" | "expiring" | "disconnected";

export interface User {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  auth_provider: string;
  email_verified: number;
  is_admin: number;
  created_at: string;
}

export interface BrandProfile {
  businessName?: string;
  industry?: string;
  audience?: string;
  tone?: Tone;
  defaultHashtags?: string;
  bannedWords?: string;
  bannedHashtags?: string;
  languages?: string[];
  website?: string;
  contactLink?: string;
}

export type Tone = "professional" | "friendly" | "bold" | "faith" | "luxury";

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  plan: PlanId;
  plan_status: "active" | "past_due" | "paused";
  timezone: string;
  brand_json: string;
  require_approval: number;
  trial_ends_at: string | null;
  created_at: string;
}

export type PlanId = "trial" | "starter" | "growth" | "agency";

export interface SocialAccount {
  id: string;
  workspace_id: string;
  platform: Platform;
  external_id: string;
  name: string;
  avatar_url: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  status: AccountStatus;
  connection_type: "official" | "unofficial" | "demo";
  meta_json: string;
  created_at: string;
}

export interface MediaAsset {
  id: string;
  workspace_id: string;
  filename: string;
  storage_key: string;
  mime: string;
  type: "image" | "video";
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  tags: string;
  folder: string;
  created_at: string;
}

export interface Post {
  id: string;
  workspace_id: string;
  author_id: string;
  master_text: string;
  hint: string;
  language: string;
  media_ids: string;
  status: PostStatus;
  scheduled_at: string | null;
  recurrence: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostVariant {
  id: string;
  post_id: string;
  platform: Platform;
  social_account_id: string;
  text: string;
  title: string | null;
  tags: string | null;
  settings_json: string;
  ai_generated: number;
  locked: number;
  status: VariantStatus;
  platform_post_id: string | null;
  published_url: string | null;
  error_message: string | null;
  published_at: string | null;
}
