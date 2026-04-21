"use client";

import { useEffect } from "react";
import { TranscriptPanel } from "@/components/transcript-panel";
import { SuggestionsPanel } from "@/components/suggestions-panel";
import { ChatPanel } from "@/components/chat-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { getContextMetadata } from "@/lib/api-client";
import { useSessionStore, getDefaultSettings } from "@/lib/session-store";
import { downloadJson, buildExportPayload } from "@/lib/export-session";
import { SessionControllerProvider } from "@/lib/session-controller";
import { readStoredSettings, settingsStorageKey } from "@/lib/settings-storage";

const MISSING_API_KEY_ERROR =
  "Add your Groq API key in settings before using the app";

export function AppShell() {
  const isSettingsOpen = useSessionStore((state) => state.isSettingsOpen);
  const setSettingsOpen = useSessionStore((state) => state.setSettingsOpen);
  const hydrateSettings = useSessionStore((state) => state.hydrateSettings);
  const settings = useSessionStore((state) => state.settings);
  const error = useSessionStore((state) => state.error);
  const clearSessionError = useSessionStore((state) => state.clearSessionError);

  useEffect(() => {
    const storedSettings = readStoredSettings();
    if (!storedSettings) {
      hydrateSettings(getDefaultSettings());
      return;
    }
    hydrateSettings(storedSettings);
  }, [hydrateSettings]);

  useEffect(() => {
    window.sessionStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (
      error === MISSING_API_KEY_ERROR &&
      settings.groqApiKey.trim()
    ) {
      clearSessionError();
    }
  }, [clearSessionError, error, settings.groqApiKey]);

  const exportSession = async () => {
    const state = useSessionStore.getState();
    let contextMetadata = null;

    try {
      contextMetadata = await getContextMetadata(state.startedAt);
    } catch {
      contextMetadata = null;
    }

    downloadJson(
      `twinmind-session-${Date.now()}.json`,
      buildExportPayload(state, contextMetadata),
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
              className="subtle-button white-border-button"
              onClick={() => void exportSession()}
              type="button"
            >
              Export
            </button>
            <button
              className="subtle-button settings-glow-button"
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
