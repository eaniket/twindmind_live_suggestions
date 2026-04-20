"use client";

import { useSessionStore } from "@/lib/session-store";
import { useSessionController } from "@/lib/session-controller";
import { formatTime } from "@/lib/time";

const suggestionLabels = {
  question_to_ask: "Question to ask",
  talking_point: "Talking point",
  answer: "Answer",
  fact_check: "Fact-check",
};

const lightingModeTooltip =
  "In lighting mode, suggestions appear more quickly, with the trade off on last sentence. Turn it off for more accurate suggestions";

export function SuggestionsPanel() {
  const suggestionBatches = useSessionStore((state) => state.suggestionBatches);
  const isTranscribing = useSessionStore((state) => state.isTranscribing);
  const isGeneratingSuggestions = useSessionStore(
    (state) => state.isGeneratingSuggestions,
  );
  const lightingMode = useSessionStore((state) => state.settings.lightingMode);
  const { refreshSuggestions, clickSuggestion, countdown, isReloadBusy } =
    useSessionController();
  const isVisibleReloadBusy =
    isReloadBusy || isTranscribing || isGeneratingSuggestions;

  return (
    <section className="panel">
      <header className="panel-header">
        <span className="panel-heading-with-badge">
          <span>2. Live Suggestions</span>
          {lightingMode ? (
            <span className="lighting-badge-tooltip">
              <span
                aria-label={lightingModeTooltip}
                className="lighting-badge"
                tabIndex={0}
              >
                ⚡
              </span>
              <span className="lighting-badge-tooltip-content" role="tooltip">
                {lightingModeTooltip}
              </span>
            </span>
          ) : null}
        </span>
        <span>{suggestionBatches.length} batches</span>
      </header>
      <div className="suggestion-toolbar">
        <div className="toolbar-actions">
          <button
            className="subtle-button white-border-button"
            disabled={isVisibleReloadBusy}
            onClick={() => void refreshSuggestions()}
            type="button"
          >
            {isVisibleReloadBusy ? (
              <span aria-hidden="true" className="button-spinner" />
            ) : (
              <span aria-hidden="true">↻ </span>
            )}
            Reload suggestions
          </button>
        </div>
        <span className="countdown">auto-refresh in {countdown}s</span>
      </div>
      <div className="panel-body">
        <div className="banner">
          On reload or every ~30 seconds, generate 3 fresh suggestions from recent
          transcript context. New batches appear at the top and older batches stay
          visible below.
        </div>
        {suggestionBatches.length === 0 ? (
          <div className="empty">
            Suggestions appear here once recording starts.
          </div>
        ) : (
          suggestionBatches.map((batch, batchIndex) => (
            <div
              className="suggestion-batch"
              key={`${batch.id}-${batch.createdAt}-${batchIndex}`}
            >
              {batch.suggestions.map((suggestion, suggestionIndex) => (
                <button
                  className={`suggestion-card${batchIndex === 0 ? " is-fresh" : " is-stale"}`}
                  key={`${batch.id}-${suggestion.id}-${suggestionIndex}`}
                  onClick={() => void clickSuggestion(suggestion)}
                  type="button"
                >
                  <span className={`suggestion-tag ${suggestion.type}`}>
                    {suggestionLabels[suggestion.type]}
                  </span>
                  <div className="suggestion-title">{suggestion.preview}</div>
                </button>
              ))}
              <div className="suggestion-divider">
                Batch {suggestionBatches.length - batchIndex} · {formatTime(batch.createdAt)}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
