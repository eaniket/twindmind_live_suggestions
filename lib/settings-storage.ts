import type { SessionSettings } from "@/types/session";

export const settingsStorageKey = "twinmind-session-settings";

export function readStoredSettings(): SessionSettings | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(settingsStorageKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionSettings;
  } catch {
    return null;
  }
}

export function readStoredApiKey() {
  return readStoredSettings()?.groqApiKey?.trim() ?? "";
}
