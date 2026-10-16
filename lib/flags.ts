import { all, get, run } from "./db";

export function flagEnabled(key: string): boolean {
  return Boolean(get<{ enabled: number }>("SELECT enabled FROM feature_flags WHERE key = ?", key)?.enabled);
}

export function listFlags() {
  return all<{ key: string; enabled: number; description: string }>("SELECT * FROM feature_flags ORDER BY key");
}

export function setFlag(key: string, enabled: boolean) {
  run("UPDATE feature_flags SET enabled = ? WHERE key = ?", enabled ? 1 : 0, key);
}
