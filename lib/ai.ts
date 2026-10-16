import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { PLATFORMS } from "./platforms";
import type { BrandProfile, MediaAsset, Platform } from "./types";

/**
 * AI optimisation engine (PRD §5). Turns one master draft into platform-ready versions
 * in a single request, guided by the workspace brand profile. Never invents facts.
 */

export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";

const VariantSchema = z.object({
  platform: z.enum(["facebook", "instagram", "linkedin", "youtube", "tiktok", "whatsapp_status"]),
  text: z.string().describe("The caption / post body / description, ready to publish"),
  title: z.string().nullable().describe("YouTube title only, otherwise null"),
  tags: z.array(z.string()).describe("YouTube tags only, otherwise empty"),
  hashtags: z.array(z.string()).describe("Hashtags already included in text, for reference"),
  alt_text: z.string().nullable().describe("Instagram image alt text, otherwise null"),
  notes: z.string().describe("One short sentence on what was optimised"),
});

const OutputSchema = z.object({
  variants: z.array(VariantSchema),
  policy_flags: z
    .array(z.object({ severity: z.enum(["warning", "block"]), message: z.string() }))
    .describe("Possible platform-policy problems in the customer's content (e.g. guaranteed financial returns)"),
});

export type AiVariant = z.infer<typeof VariantSchema>;
export type AiOutput = z.infer<typeof OutputSchema>;

const PLATFORM_GUIDE: Record<Platform, string> = {
  facebook:
    "Conversational caption, hook in the first line, short readable paragraphs, an engagement question, clear call to action, 3-5 relevant hashtags at the end, link placed after the CTA.",
  instagram:
    "Strong first line (it shows before 'more'), line breaks, searchable keywords in the caption, a mix of broad and niche hashtags (8-15), alt text describing the media.",
  linkedin:
    "Professional post: a hook, short paragraphs, an insight or lesson, industry keywords, no hard selling in the opening, 3-5 hashtags at the end.",
  youtube:
    "Keyword-rich title under 70 characters with the target phrase; description with keywords in the first two lines, chapters only if timestamps are provided, then hashtags (3-5); 8-15 tags. For videos under 60s, make it a Short and include #Shorts.",
  tiktok:
    "Short caption with a strong hook, searchable TikTok keywords written naturally, 3-6 trending-style but relevant hashtags. Brevity matters.",
  whatsapp_status:
    "Very short punchy text for mobile, emoji used sparingly, urgency, local phrasing, direct call to action (e.g. 'Reply YES' or a link). No hashtags.",
};

const TONE_GUIDE: Record<string, string> = {
  professional: "Professional: confident, clear, credible.",
  friendly: "Friendly: warm, conversational, approachable.",
  bold: "Bold / Sales: energetic, persuasive, urgency-driven, still honest.",
  faith: "Faith-based: reverent, hopeful, community-focused, appropriate scripture tone where relevant.",
  luxury: "Luxury: refined, aspirational, understated elegance, no hype words.",
};

const LANGUAGE_GUIDE: Record<string, string> = {
  "en-NG": "Nigerian English: natural for Nigerian audiences (local references and spelling such as 'optimise', Naira as ₦).",
  pcm: "Nigerian Pidgin: write naturally in Pidgin as Nigerians actually speak and type it; keep brand and product names unchanged.",
};

// Stable system prompt (cached). Workspace-specific data goes in the user turn.
const SYSTEM = `You are the copy optimisation engine of a social media scheduling platform for African businesses, starting with Nigeria.
You rewrite and structure the customer's master draft into a ready-to-publish version for each requested platform.

Hard rules (guardrails):
- Never add facts, prices, dates, locations, statistics, guarantees or promises that are not in the master draft, the customer hint, or the brand profile. If information is missing, write around it; do not invent it.
- Never use any banned word or banned hashtag from the brand profile.
- Respect each platform's character limit given in the request; stay comfortably under it.
- Keep the customer's meaning, offer and call to action intact. Use the brand's contact link or website for the CTA when the draft has none.
- Hashtags must be relevant to the content; prefer the brand's default hashtags where they fit.
- Write in the requested language and tone.
- In policy_flags, flag content that may break platform policies: misleading or guaranteed financial returns, get-rich-quick claims, prohibited or regulated products, health cure claims, adult content, or hate. Use "block" only for clearly prohibited content. Return an empty list if nothing applies.

Return exactly one variant per requested platform.`;

export interface OptimiseInput {
  masterText: string;
  hint?: string;
  language: string;
  brand: BrandProfile;
  platforms: Platform[];
  media: Pick<MediaAsset, "type" | "duration" | "width" | "height" | "filename">[];
}

export interface OptimiseResult {
  output: AiOutput;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function buildUserPrompt(input: OptimiseInput) {
  const b = input.brand;
  const lines = [
    "## Brand profile",
    `Business: ${b.businessName || "(not set)"}`,
    `Industry: ${b.industry || "(not set)"}`,
    `Target audience: ${b.audience || "(not set)"}`,
    `Tone: ${TONE_GUIDE[b.tone || "friendly"]}`,
    `Default hashtags: ${b.defaultHashtags || "(none)"}`,
    `Banned words: ${b.bannedWords || "(none)"}`,
    `Banned hashtags: ${b.bannedHashtags || "(none)"}`,
    `Website: ${b.website || "(none)"}`,
    `Contact / CTA link: ${b.contactLink || "(none)"}`,
    "",
    `## Language\n${LANGUAGE_GUIDE[input.language] ?? LANGUAGE_GUIDE["en-NG"]}`,
    "",
    "## Media attached",
    input.media.length
      ? input.media
          .map(
            (m) =>
              `- ${m.type}${m.duration ? `, ${m.duration}s` : ""}${m.width ? `, ${m.width}x${m.height}` : ""} (${m.filename})`,
          )
          .join("\n")
      : "- none (text-only post)",
    "",
    "## Platforms requested",
    ...input.platforms.map(
      (p) => `- ${p} (max ${PLATFORMS[p].maxChars} characters${PLATFORMS[p].titleMax ? `, title max 70` : ""}): ${PLATFORM_GUIDE[p]}`,
    ),
    "",
    input.hint ? `## Customer hint\n${input.hint}\n` : "",
    "## Master draft",
    input.masterText,
  ];
  return lines.join("\n");
}

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function optimise(input: OptimiseInput): Promise<OptimiseResult> {
  if (!aiConfigured()) {
    return { output: heuristicOptimise(input), model: "heuristic", inputTokens: 0, outputTokens: 0 };
  }
  const client = new Anthropic();
  // Server-side fallback re-runs the request on a fallback model if a safety classifier declines.
  const response = await client.beta.messages.parse({
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    model: AI_MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(OutputSchema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });
  if (response.stop_reason === "refusal") {
    // The whole fallback chain declined.
    throw new Error("The AI declined to rewrite this content. Please review it for policy issues.");
  }
  if (!response.parsed_output) throw new Error("The AI returned an unreadable response. Please try again.");
  return {
    output: applyGuardrails(response.parsed_output, input),
    model: AI_MODEL,
    inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0),
    outputTokens: response.usage.output_tokens,
  };
}

// ---- Deterministic guardrails applied after the model ----

function splitList(s?: string) {
  return (s || "")
    .split(/[,\n]/)
    .map((x) => x.trim().replace(/^#/, "").toLowerCase())
    .filter(Boolean);
}

export function applyGuardrails(out: AiOutput, input: OptimiseInput): AiOutput {
  const bannedWords = splitList(input.brand.bannedWords);
  const bannedTags = splitList(input.brand.bannedHashtags);
  const variants = out.variants
    .filter((v) => input.platforms.includes(v.platform))
    .map((v) => {
      let text = v.text;
      for (const tag of bannedTags) text = text.replace(new RegExp(`#${escapeRe(tag)}\\b`, "gi"), "").trim();
      for (const w of bannedWords) text = text.replace(new RegExp(`\\b${escapeRe(w)}\\b`, "gi"), "").replace(/ {2,}/g, " ");
      const max = PLATFORMS[v.platform].maxChars;
      if (text.length > max) text = text.slice(0, max - 1).trimEnd() + "…";
      let title = v.title;
      if (v.platform === "youtube" && title && title.length > 100) title = title.slice(0, 99) + "…";
      return {
        ...v,
        text,
        title: v.platform === "youtube" ? title : null,
        tags: v.platform === "youtube" ? v.tags.filter((t) => !bannedTags.includes(t.toLowerCase())) : [],
      };
    });
  return { ...out, variants };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Offline fallback used when no AI key is configured (development). */
function heuristicOptimise(input: OptimiseInput): AiOutput {
  const draft = input.masterText.trim();
  const tags = splitList(input.brand.defaultHashtags).map((t) => "#" + t.replace(/\s+/g, ""));
  const cta = input.brand.contactLink || input.brand.website;
  const firstLine = draft.split(/\n|(?<=[.!?])\s/)[0] ?? draft;
  const variants: AiVariant[] = input.platforms.map((p) => {
    const max = PLATFORMS[p].maxHashtags;
    const hs = tags.slice(0, max);
    let text = draft;
    let title: string | null = null;
    if (p === "whatsapp_status") text = (firstLine.length > 160 ? firstLine.slice(0, 157) + "…" : firstLine) + (cta ? `\n👉 ${cta}` : "");
    else if (p === "youtube") {
      title = firstLine.slice(0, 70);
      text = `${draft}${cta ? `\n\n${cta}` : ""}${hs.length ? `\n\n${hs.join(" ")}` : ""}`;
    } else text = `${draft}${cta && !draft.includes(cta) ? `\n\n${cta}` : ""}${hs.length ? `\n\n${hs.join(" ")}` : ""}`;
    return {
      platform: p,
      text,
      title,
      tags: p === "youtube" ? hs.map((h) => h.slice(1)) : [],
      hashtags: hs,
      alt_text: null,
      notes: "Offline mode: basic formatting only. Set ANTHROPIC_API_KEY for full AI optimisation.",
    };
  });
  return applyGuardrails({ variants, policy_flags: [] }, input);
}
