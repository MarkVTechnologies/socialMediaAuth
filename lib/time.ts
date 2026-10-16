/** Time zone helpers. All timestamps are stored as UTC ISO strings; UI shows workspace time. */

function offsetMinutes(utc: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utc);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUtc - utc.getTime()) / 60000;
}

/** "2026-10-20T09:30" in `timeZone` -> UTC Date */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const [d, t = "00:00"] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm] = t.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, day, hh, mm));
  const off1 = offsetMinutes(guess, timeZone);
  const first = new Date(guess.getTime() - off1 * 60000);
  const off2 = offsetMinutes(first, timeZone);
  return off1 === off2 ? first : new Date(guess.getTime() - off2 * 60000);
}

/** UTC ISO -> "YYYY-MM-DDTHH:mm" in `timeZone` (for datetime-local inputs) */
export function utcToZonedLocal(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const shifted = new Date(date.getTime() + offsetMinutes(date, timeZone) * 60000);
  return shifted.toISOString().slice(0, 16);
}

export function formatInZone(iso: string, timeZone: string, opts?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
    ...opts,
  }).format(new Date(iso));
}

/** ISO timestamp `days` days before now. */
export function daysAgo(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

/** Whole days from now until `iso` (negative if past). */
export function daysUntil(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000);
}

export function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}
