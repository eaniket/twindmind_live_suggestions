export type SuggestionType =
  | "question_to_ask"
  | "answer_to_give"
  | "talking_point"
  | "next_step"
  | "fact_check";

export type ConversationMode =
  | "discovery"
  | "brainstorming"
  | "status_update"
  | "problem_solving"
  | "planning"
  | "decision_making"
  | "wrap_up";

export type ToneAndPressure =
  | "collaborative"
  | "neutral"
  | "skeptical"
  | "tense"
  | "urgent";

export type UserResponseNeed =
  | "ask_now"
  | "answer_now"
  | "reframe_now"
  | "decide_now"
  | "close_now"
  | "listen_only";

export type RiskSignal =
  | "factual_uncertainty"
  | "misalignment"
  | "decision_ambiguity"
  | "ownership_gap"
  | "timeline_risk";

export type ContextMetadataStatus =
  | "ready"
  | "refreshing"
  | "stale"
  | "failed";

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
  lightingMode: boolean;
  chatContextChunkCount: number;
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

export type ExpandedSuggestionAffinity = {
  dominantType: SuggestionType | null;
  countsByType: Record<SuggestionType, number>;
};

export type ContextMetadata = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  status: ContextMetadataStatus;
  basedOnChunkIds: string[];
  llmSummary: string;
  conversationMode: ConversationMode;
  toneAndPressure: ToneAndPressure;
  userResponseNeed: UserResponseNeed;
  expandedSuggestionAffinity: ExpandedSuggestionAffinity;
  riskSignals: RiskSignal[];
};

export type StoredContextMetadata = ContextMetadata & {
  version: number;
  error?: string;
};

export type SessionContextRecord = {
  sessionId: string;
  updatedAt: string;
  transcriptChunks: TranscriptChunk[];
  suggestionBatches: SuggestionBatch[];
  chatMessages: ChatMessage[];
  rollingSummary: string;
};
