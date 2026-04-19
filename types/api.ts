import type { ChatMessage, SuggestionBatch, TranscriptChunk } from "@/types/session";

export type TranscribeRequest = {
  blob: Blob;
  apiKey: string;
  language: string;
  startedAt: string;
  endedAt: string;
  source: "auto" | "manual-flush";
};

export type SuggestionsRequest = {
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
  apiKey: string;
  chatMessages: ChatApiMessage[];
  transcriptText: string;
  rollingSummary: string;
  prompt: string;
  userMessage: string;
};

export type TranscribeResponse = TranscriptChunk;
export type SuggestionsResponse = SuggestionBatch;
export type ChatHistoryMessage = Pick<ChatMessage, "role" | "text">;
