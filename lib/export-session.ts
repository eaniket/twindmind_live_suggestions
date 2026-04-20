import type { SessionState } from "@/types/session";

export function buildExportPayload(state: SessionState) {
  return {
    session: {
      startedAt: state.startedAt,
      endedAt: new Date().toISOString(),
      settings: {
        language: state.settings.language,
        autoRefreshSeconds: state.settings.autoRefreshSeconds,
        suggestionContextChunkCount: state.settings.suggestionContextChunkCount,
        chatContextChunkCount: state.settings.chatContextChunkCount,
      },
    },
    transcriptChunks: state.transcriptChunks,
    suggestionBatches: state.suggestionBatches,
    chatMessages: state.chatMessages,
    rollingSummary: state.rollingSummary,
  };
}

export function downloadJson(filename: string, data: object) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
