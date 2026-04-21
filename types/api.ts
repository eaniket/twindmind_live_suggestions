import type {
  ChatMessage,
  SessionContextRecord,
  StoredContextMetadata,
  SuggestionBatch,
  TranscriptChunk,
} from "@/types/session";

export type TranscribeRequest = {
  blob: Blob;
  apiKey: string;
  language: string;
  startedAt: string;
  endedAt: string;
  source: "auto" | "manual-flush";
};

export type SuggestionsRequest = {
  sessionId: string;
  apiKey: string;
  rollingSummary: string;
  transcriptText: string;
  recentSuggestions: string;
  basedOnChunkIds: string[];
  prompt: string;
};

export type ChatApiMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatRequest = {
  sessionId: string;
  apiKey: string;
  chatMessages: ChatApiMessage[];
  transcriptText: string;
  rollingSummary: string;
  prompt: string;
  userMessage: string;
};

export type ContextMetadataRefreshRequest = {
  sessionId: string;
  apiKey: string;
  rollingSummary: string;
  transcriptChunks: TranscriptChunk[];
  suggestionBatches: SuggestionBatch[];
  chatMessages: ChatMessage[];
};

export type ContextMetadataRefreshResponse = {
  status: "started" | "queued";
};

export type ContextMetadataResponse = StoredContextMetadata | null;
export type SessionContextResponse = SessionContextRecord | null;

export type TranscribeResponse = TranscriptChunk;
export type SuggestionsResponse = SuggestionBatch;
