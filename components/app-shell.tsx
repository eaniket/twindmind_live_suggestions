"use client";

import { useEffect } from "react";
import { TranscriptPanel } from "@/components/transcript-panel";
import { SuggestionsPanel } from "@/components/suggestions-panel";
import { ChatPanel } from "@/components/chat-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { useSessionStore, getDefaultSettings } from "@/lib/session-store";
import { downloadJson, buildExportPayload } from "@/lib/export-session";
import { SessionControllerProvider } from "@/lib/session-controller";

const settingsStorageKey = "twinmind-session-settings";

export function AppShell() {
  const isSettingsOpen = useSessionStore((state) => state.isSettingsOpen);
  const setSettingsOpen = useSessionStore((state) => state.setSettingsOpen);
  const hydrateSettings = useSessionStore((state) => state.hydrateSettings);
  const settings = useSessionStore((state) => state.settings);
  const error = useSessionStore((state) => state.error);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(settingsStorageKey);
    if (!raw) {
      hydrateSettings(getDefaultSettings());
      return;
    }
    try {
      const parsed = JSON.parse(raw) as ReturnType<typeof getDefaultSettings>;
      hydrateSettings(parsed);
    } catch {
      hydrateSettings(getDefaultSettings());
    }
  }, [hydrateSettings]);

  useEffect(() => {
    window.sessionStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  }, [settings]);

  const exportSession = () => {
    downloadJson(
      `twinmind-session-${Date.now()}.json`,
      buildExportPayload(useSessionStore.getState()),
    );
  };

  return (
    <SessionControllerProvider>
      <main className="app-shell">
        <header className="topbar">
          <div className="topbar-copy">
            <h1>TwinMind Live Suggestions</h1>
            <p>3-column layout · Transcript · Live Suggestions · Chat</p>
          </div>
          <div className="topbar-actions">
            {error ? <span className="error-text">{error}</span> : null}
            <button
              className="subtle-button"
              onClick={exportSession}
              type="button"
            >
              Export
            </button>
            <button
              className="subtle-button"
              onClick={() => setSettingsOpen(true)}
              type="button"
            >
              Settings
            </button>
          </div>
        </header>

        <section className="layout">
          <TranscriptPanel />
          <SuggestionsPanel />
          <ChatPanel />
        </section>

        <SettingsDialog open={isSettingsOpen} />
      </main>
    </SessionControllerProvider>
  );
}
