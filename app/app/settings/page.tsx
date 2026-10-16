import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { all, run } from "@/lib/db";
import { id } from "@/lib/crypto";
import { audit } from "@/lib/notify";
import { LANGUAGES, TONES } from "@/lib/platforms";
import { can, requireRole, requireWorkspace } from "@/lib/workspace";
import { Alert, PageHeader } from "@/components/ui";
import type { BrandProfile, Tone } from "@/lib/types";

export const metadata = { title: "Brand & settings" };

const TIMEZONES = ["Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "Africa/Johannesburg", "Africa/Cairo", "Europe/London", "America/New_York"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function saveBrand(form: FormData) {
  "use server";
  const ctx = await requireRole(can.manageTeam);
  const s = (k: string, max = 500) => String(form.get(k) || "").trim().slice(0, max);
  const brand: BrandProfile = {
    businessName: s("businessName", 120),
    industry: s("industry", 120),
    audience: s("audience", 500),
    tone: (s("tone") || "friendly") as Tone,
    defaultHashtags: s("defaultHashtags"),
    bannedWords: s("bannedWords"),
    bannedHashtags: s("bannedHashtags"),
    languages: form.getAll("languages").map(String),
    website: s("website", 300),
    contactLink: s("contactLink", 300),
  };
  run("UPDATE workspaces SET brand_json = ? WHERE id = ?", JSON.stringify(brand), ctx.workspace.id);
  audit("workspace.brand_updated", { workspaceId: ctx.workspace.id, actorId: ctx.user.id });
  revalidatePath("/app", "layout");
  redirect("/app/settings?saved=brand");
}

async function saveWorkspace(form: FormData) {
  "use server";
  const ctx = await requireRole(can.manageTeam);
  const tz = String(form.get("timezone"));
  const name = String(form.get("name") || "").trim().slice(0, 120) || ctx.workspace.name;
  run(
    "UPDATE workspaces SET name = ?, timezone = ?, require_approval = ? WHERE id = ?",
    name,
    TIMEZONES.includes(tz) ? tz : "Africa/Lagos",
    form.get("require_approval") === "on" ? 1 : 0,
    ctx.workspace.id,
  );
  audit("workspace.settings_updated", { workspaceId: ctx.workspace.id, actorId: ctx.user.id });
  revalidatePath("/app", "layout");
  redirect("/app/settings?saved=workspace");
}

async function addSlot(form: FormData) {
  "use server";
  const ctx = await requireRole(can.schedule);
  const time = String(form.get("time"));
  if (!/^\d{2}:\d{2}$/.test(time)) return;
  for (const d of form.getAll("weekday").map(Number)) {
    if (d >= 0 && d <= 6) run("INSERT INTO queue_slots (id, workspace_id, weekday, time) VALUES (?, ?, ?, ?)", id("qs_"), ctx.workspace.id, d, time);
  }
  revalidatePath("/app/settings");
}

async function removeSlot(form: FormData) {
  "use server";
  const ctx = await requireRole(can.schedule);
  run("DELETE FROM queue_slots WHERE id = ? AND workspace_id = ?", String(form.get("id")), ctx.workspace.id);
  revalidatePath("/app/settings");
}

async function deleteWorkspace(form: FormData) {
  "use server";
  const ctx = await requireRole((r) => r === "owner");
  if (String(form.get("confirm")) !== ctx.workspace.name) redirect("/app/settings?error=Type+the+workspace+name+to+confirm");
  // Cascades remove accounts (and their encrypted tokens), posts, media records, etc.
  run("DELETE FROM workspaces WHERE id = ?", ctx.workspace.id);
  audit("workspace.deleted", { actorId: ctx.user.id, target: ctx.workspace.id, details: { name: ctx.workspace.name } });
  redirect("/app");
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { workspace, brand, role } = await requireWorkspace();
  const { saved, error } = await searchParams;
  const editable = can.manageTeam(role);
  const slots = all<{ id: string; weekday: number; time: string }>(
    "SELECT * FROM queue_slots WHERE workspace_id = ? ORDER BY weekday, time",
    workspace.id,
  );

  return (
    <>
      <PageHeader title="Brand & settings" description="Your brand profile guides every AI rewrite." />
      {saved && <div className="mb-4"><Alert tone="ok">Saved.</Alert></div>}
      {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}

      <div className="grid gap-6 xl:grid-cols-2">
        <form action={saveBrand} className="card space-y-4 p-5">
          <h2 className="font-medium">Brand profile</h2>
          <fieldset disabled={!editable} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Business name</label>
                <input name="businessName" className="field" defaultValue={brand.businessName} />
              </div>
              <div>
                <label className="label">Industry</label>
                <input name="industry" className="field" defaultValue={brand.industry} placeholder="e.g. Real estate" />
              </div>
            </div>
            <div>
              <label className="label">Target audience</label>
              <textarea name="audience" className="field" defaultValue={brand.audience} placeholder="e.g. First-time home buyers in Abuja and Lagos, 28–45" />
            </div>
            <div>
              <label className="label">Tone of voice</label>
              <select name="tone" className="field" defaultValue={brand.tone ?? "friendly"}>
                {TONES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="label">Preferred languages</span>
              <div className="flex flex-wrap gap-4 text-sm">
                {LANGUAGES.map((l) => (
                  <label key={l.id} className="flex items-center gap-2">
                    <input type="checkbox" name="languages" value={l.id} defaultChecked={(brand.languages ?? ["en-NG"]).includes(l.id)} />
                    {l.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Default hashtags</label>
              <input name="defaultHashtags" className="field" defaultValue={brand.defaultHashtags} placeholder="#LagosRealEstate, #AbujaHomes" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Banned words</label>
                <input name="bannedWords" className="field" defaultValue={brand.bannedWords} placeholder="cheap, guaranteed" />
              </div>
              <div>
                <label className="label">Banned hashtags</label>
                <input name="bannedHashtags" className="field" defaultValue={brand.bannedHashtags} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Website</label>
                <input name="website" className="field" defaultValue={brand.website} placeholder="https://" />
              </div>
              <div>
                <label className="label">Contact / CTA link</label>
                <input name="contactLink" className="field" defaultValue={brand.contactLink} placeholder="https://wa.me/234…" />
              </div>
            </div>
            {editable && <button className="btn-primary">Save brand profile</button>}
          </fieldset>
        </form>

        <div className="space-y-6">
          <form action={saveWorkspace} className="card space-y-4 p-5">
            <h2 className="font-medium">Workspace</h2>
            <fieldset disabled={!editable} className="space-y-4">
              <div>
                <label className="label">Name</label>
                <input name="name" className="field" defaultValue={workspace.name} />
              </div>
              <div>
                <label className="label">Time zone</label>
                <select name="timezone" className="field" defaultValue={workspace.timezone}>
                  {TIMEZONES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="require_approval" defaultChecked={Boolean(workspace.require_approval)} className="mt-1" />
                <span>
                  Require approval for all posts
                  <span className="block text-muted">Editors&apos; posts also wait for an Admin or Client Approver. Contributors always need approval.</span>
                </span>
              </label>
              {editable && <button className="btn-primary">Save workspace</button>}
            </fieldset>
          </form>

          <section className="card space-y-4 p-5">
            <div>
              <h2 className="font-medium">Posting queue</h2>
              <p className="text-sm text-muted">Set regular time slots. &ldquo;Add to queue&rdquo; puts a post into the next free slot.</p>
            </div>
            {slots.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {slots.map((s) => (
                  <form key={s.id} action={removeSlot} className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm">
                    {WEEKDAYS[s.weekday]} {s.time}
                    <input type="hidden" name="id" value={s.id} />
                    <button className="h-5 w-5 rounded-full text-muted hover:bg-border" aria-label="Remove slot">×</button>
                  </form>
                ))}
              </div>
            )}
            <form action={addSlot} className="space-y-3">
              <div className="flex flex-wrap gap-3 text-sm">
                {WEEKDAYS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1">
                    <input type="checkbox" name="weekday" value={i} defaultChecked={i >= 1 && i <= 5} /> {d}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <input type="time" name="time" defaultValue="09:00" className="field w-auto" required />
                <button className="btn-secondary">Add slot</button>
              </div>
            </form>
          </section>

          {role === "owner" && (
            <form action={deleteWorkspace} className="card space-y-3 border-danger/40 p-5">
              <h2 className="font-medium text-danger">Delete workspace</h2>
              <p className="text-sm text-muted">
                Permanently deletes this workspace, its posts and media records, and all stored social account tokens.
              </p>
              <input name="confirm" className="field" placeholder={`Type "${workspace.name}" to confirm`} />
              <button className="btn-danger">Delete workspace</button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
