"use client";

import { type ChangeEvent, useEffect, useState } from "react";
import { useSessionStore } from "@/lib/session-store";
import type { SessionSettings } from "@/types/session";

type SettingsDialogProps = {
  open: boolean;
};

type SettingsFieldName =
  | "groqApiKey"
  | "language"
  | "autoRefreshSeconds"
  | "suggestionContextChunkCount"
  | "chatContextChunkCount"
  | "suggestionPrompt"
  | "detailedAnswerPrompt"
  | "chatPrompt";

export function SettingsDialog({ open }: SettingsDialogProps) {
  const settings = useSessionStore((state) => state.settings);
  const setSettings = useSessionStore((state) => state.setSettings);
  const setSettingsOpen = useSessionStore((state) => state.setSettingsOpen);
  const [draft, setDraft] = useState<SessionSettings>(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  if (!open) {
    return null;
  }

  const updateText = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = event.target;
    const field = name as SettingsFieldName;
    if (
      field === "autoRefreshSeconds" ||
      field === "suggestionContextChunkCount" ||
      field === "chatContextChunkCount"
    ) {
      setDraft({ ...draft, [field]: Number(value) });
      return;
    }
    setDraft({ ...draft, [field]: value });
  };

  const updateToggle = (event: ChangeEvent<HTMLInputElement>) => {
    setDraft({ ...draft, includeChatInSuggestions: event.target.checked });
  };

  const save = () => {
    setSettings(draft);
    setSettingsOpen(false);
  };

  return (
    <div className="settings-backdrop">
      <div className="settings-dialog">
        <div className="settings-header">
          <div>
            <div>TwinMind Settings</div>
            <div className="muted-text">
              Session-scoped settings for Groq API access and prompts.
            </div>
          </div>
          <button
            className="text-button"
            onClick={() => setSettingsOpen(false)}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="settings-grid">
          <label className="settings-field is-full">
            <span className="settings-label">Groq API key</span>
            <input
              className="settings-input"
              name="groqApiKey"
              onChange={updateText}
              type="password"
              value={draft.groqApiKey}
            />
          </label>

          <label className="settings-field">
            <span className="settings-label">Language</span>
            <input
              className="settings-input"
              name="language"
              onChange={updateText}
              value={draft.language}
            />
          </label>

          <label className="settings-field">
            <span className="settings-label">Auto refresh seconds</span>
            <input
              className="settings-input"
              min={15}
              name="autoRefreshSeconds"
              onChange={updateText}
              type="number"
              value={draft.autoRefreshSeconds}
            />
          </label>

          <label className="settings-field">
            <span className="settings-label">Suggestion context chunks</span>
            <input
              className="settings-input"
              min={1}
              name="suggestionContextChunkCount"
              onChange={updateText}
              type="number"
              value={draft.suggestionContextChunkCount}
            />
          </label>

          <label className="settings-field">
            <span className="settings-label">Chat context chunks</span>
            <input
              className="settings-input"
              min={1}
              name="chatContextChunkCount"
              onChange={updateText}
              type="number"
              value={draft.chatContextChunkCount}
            />
          </label>

          <label className="settings-field is-full">
            <span className="settings-label">Include chat in suggestions</span>
            <span className="settings-toggle">
              <input
                checked={draft.includeChatInSuggestions}
                onChange={updateToggle}
                type="checkbox"
              />
              <span className="muted-text">Use recent chat turns in suggestion context</span>
            </span>
          </label>

          <label className="settings-field is-full">
            <span className="settings-label">Live suggestion prompt</span>
            <textarea
              className="settings-textarea"
              name="suggestionPrompt"
              onChange={updateText}
              value={draft.suggestionPrompt}
            />
          </label>

          <label className="settings-field is-full">
            <span className="settings-label">Detailed answer prompt</span>
            <textarea
              className="settings-textarea"
              name="detailedAnswerPrompt"
              onChange={updateText}
              value={draft.detailedAnswerPrompt}
            />
          </label>

          <label className="settings-field is-full">
            <span className="settings-label">Chat prompt</span>
            <textarea
              className="settings-textarea"
              name="chatPrompt"
              onChange={updateText}
              value={draft.chatPrompt}
            />
          </label>
        </div>

        <div className="settings-footer">
          <span className="muted-text">Stored in session storage for this tab.</span>
          <button className="primary-button" onClick={save} type="button">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
