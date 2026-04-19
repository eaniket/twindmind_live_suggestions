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

export function SuggestionsPanel() {
  const suggestionBatches = useSessionStore((state) => state.suggestionBatches);
  const isGeneratingSuggestions = useSessionStore(
    (state) => state.isGeneratingSuggestions,
  );
  const { refreshSuggestions, clickSuggestion, countdown } = useSessionController();

  return (
    <section className="panel">
      <header className="panel-header">
        <span>2. Live Suggestions</span>
        <span>{suggestionBatches.length} batches</span>
      </header>
      <div className="suggestion-toolbar">
        <div className="toolbar-actions">
          <button
            className="subtle-button"
            disabled={isGeneratingSuggestions}
            onClick={() => void refreshSuggestions()}
            type="button"
          >
            {isGeneratingSuggestions ? (
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
