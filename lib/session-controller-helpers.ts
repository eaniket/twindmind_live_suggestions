import {
  buildSuggestionContext,
  formatChatHistory,
  formatSuggestionHistory,
  formatTranscriptChunks,
} from "@/lib/context";
import type {
  ChatMessage,
  SessionState,
  Suggestion,
} from "@/types/session";

const RELOAD_SUGGESTION_TRANSCRIPT_LIMIT = 2;
const RELOAD_SUGGESTION_BATCH_LIMIT = 1;
const CHAT_TRANSCRIPT_LIMIT = 4;
const CHAT_HISTORY_LIMIT = 4;
const CHAT_SEED_HISTORY_LIMIT = 2;

type SuggestionContextTuning = {
  transcriptLimit: number;
  suggestionBatchLimit: number;
};

type SuggestionStateOverrides = Partial<
  Pick<
    SessionState,
    "transcriptChunks" | "suggestionBatches" | "rollingSummary"
  >
>;

export type SuggestionSnapshot = {
  sessionId: string;
  apiKey: string;
  rollingSummary: string;
  transcriptText: string;
  recentSuggestions: string;
  basedOnChunkIds: string[];
  prompt: string;
};

export function buildSuggestionSnapshot(
  state: SessionState,
  apiKey: string,
  overrides?: SuggestionStateOverrides,
  tuning?: SuggestionContextTuning,
): SuggestionSnapshot | null {
  const transcriptChunks = overrides?.transcriptChunks ?? state.transcriptChunks;
  const suggestionBatches =
    overrides?.suggestionBatches ?? state.suggestionBatches;
  const rollingSummary = overrides?.rollingSummary ?? state.rollingSummary;

  if (!transcriptChunks.length) {
    return null;
  }

  const context = buildSuggestionContext({
    transcriptChunks,
    suggestionBatches,
    transcriptLimit:
      tuning?.transcriptLimit ?? state.settings.suggestionContextChunkCount,
    suggestionBatchLimit: tuning?.suggestionBatchLimit,
  });

  return {
    sessionId: state.startedAt,
    apiKey,
    rollingSummary,
    transcriptText: formatTranscriptChunks(context.recentChunks),
    recentSuggestions: formatSuggestionHistory(context.recentSuggestionBatches),
    basedOnChunkIds: context.recentChunks.map((chunk) => chunk.id),
    prompt: state.settings.suggestionPrompt,
  };
}

export function buildReloadSuggestionSnapshot(
  state: SessionState,
  apiKey: string,
) {
  return buildSuggestionSnapshot(state, apiKey, undefined, {
    transcriptLimit: Math.min(
      state.settings.suggestionContextChunkCount,
      RELOAD_SUGGESTION_TRANSCRIPT_LIMIT,
    ),
    suggestionBatchLimit: RELOAD_SUGGESTION_BATCH_LIMIT,
  });
}

export function getChatTranscriptText(state: SessionState) {
  return formatTranscriptChunks(
    state.transcriptChunks.slice(
      -Math.min(state.settings.chatContextChunkCount, CHAT_TRANSCRIPT_LIMIT),
    ),
  );
}

export function getRecentChatMessages(state: SessionState) {
  return state.chatMessages.slice(-CHAT_HISTORY_LIMIT).map((chatMessage) => ({
    role: chatMessage.role,
    content: chatMessage.text,
  }));
}

export function buildSuggestionClickSeed(
  suggestion: Suggestion,
  chatMessages: ChatMessage[],
) {
  return [
    `Suggestion type: ${suggestion.type}`,
    `Suggestion preview: ${suggestion.preview}`,
    `Expand on this for the user: ${suggestion.detailedPromptSeed}`,
    formatChatHistory(chatMessages.slice(-CHAT_SEED_HISTORY_LIMIT)),
  ]
    .filter(Boolean)
    .join("\n\n");
}
