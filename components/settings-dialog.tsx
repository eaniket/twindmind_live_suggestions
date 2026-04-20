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
  | "lightingMode"
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

  const toggleBoolean = (field: Extract<SettingsFieldName, "lightingMode">) => {
    setDraft({ ...draft, [field]: !draft[field] });
  };

  const save = () => {
    setSettings(draft);
    setSettingsOpen(false);
  };

  const renderTooltip = (
    label: string,
    description: string,
    options?: { align?: "bottom" | "right" },
  ) => (
    <span className="settings-label">
      {label}
      <span
        className={`settings-tooltip${options?.align === "right" ? " is-right" : ""}`}
      >
        <span
          aria-label={`${label} info`}
          className="settings-tooltip-trigger"
          tabIndex={0}
        >
          i
        </span>
        <span className="settings-tooltip-content" role="tooltip">
          {description}
        </span>
      </span>
    </span>
  );

  return (
    <div
      className="settings-backdrop"
      onClick={() => setSettingsOpen(false)}
      role="presentation"
    >
      <div
        className="settings-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <div>
            <div>TwinMind Settings</div>
            <div className="muted-text">
              Session-scoped settings for Groq API access and prompts.
            </div>
          </div>
          <button
            aria-label="Close settings"
            className="settings-close-button"
            onClick={() => setSettingsOpen(false)}
            type="button"
          >
            ×
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

          <div className="settings-toggle-row settings-toggle-row--triple">
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

            <div className="settings-field">
              <div className="settings-toggle-header">
                {renderTooltip(
                  "Lighting mode",
                  "In lighting mode, suggestions appear more quickly, with the trade off on last sentence. Turn it off for more accurate suggestions",
                )}
              </div>
              <label className="settings-toggle-button">
                <span className="settings-label-detail">
                  {draft.lightingMode ? "On" : "Off"}
                </span>
                <span className="settings-toggle">
                  <input
                    checked={draft.lightingMode}
                    className="settings-toggle-input"
                    name="lightingMode"
                    onChange={() => toggleBoolean("lightingMode")}
                    type="checkbox"
                  />
                  <span className="settings-toggle-switch" />
                </span>
              </label>
            </div>
          </div>

          <label className="settings-field">
            {renderTooltip(
              "Suggestion context chunks",
              "How much transcript the app uses to decide the next 3 live suggestions.",
              { align: "right" },
            )}
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
            {renderTooltip(
              "Chat context chunks",
              "How much transcript the app uses to answer a question or expand a clicked suggestion.",
            )}
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
