export type SuggestionType =
  | "question_to_ask"
  | "talking_point"
  | "answer"
  | "fact_check";

export type TranscriptSegment = {
  startSec: number;
  endSec: number;
  text: string;
};

export type TranscriptChunk = {
  id: string;
  startedAt: string;
  endedAt: string;
  createdAt: string;
  text: string;
  source: "auto" | "manual-flush";
  segments: TranscriptSegment[];
};

export type Suggestion = {
  id: string;
  type: SuggestionType;
  preview: string;
  detailedPromptSeed: string;
  rationale: string;
  confidence: "high" | "medium" | "low";
};

export type SuggestionBatch = {
  id: string;
  createdAt: string;
  basedOnChunkIds: string[];
  suggestions: [Suggestion, Suggestion, Suggestion];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  text: string;
  source: "typed" | "suggestion_click" | "assistant";
  relatedSuggestionId?: string;
};

export type SessionSettings = {
  groqApiKey: string;
  language: string;
  autoRefreshSeconds: number;
  suggestionContextChunkCount: number;
  chatContextChunkCount: number;
  includeChatInSuggestions: boolean;
  suggestionPrompt: string;
  detailedAnswerPrompt: string;
  chatPrompt: string;
};

export type SessionState = {
  startedAt: string;
  transcriptChunks: TranscriptChunk[];
  suggestionBatches: SuggestionBatch[];
  chatMessages: ChatMessage[];
  rollingSummary: string;
  settings: SessionSettings;
  isRecording: boolean;
  isTranscribing: boolean;
  isGeneratingSuggestions: boolean;
  isChatStreaming: boolean;
  isSettingsOpen: boolean;
  error: string;
};
