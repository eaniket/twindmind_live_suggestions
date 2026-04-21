import { z } from "zod";

export const suggestionTypeSchema = z.enum([
  "question_to_ask",
  "answer_to_give",
  "talking_point",
  "next_step",
  "fact_check",
]);

export const transcriptSegmentSchema = z.object({
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
});

export const transcriptChunkSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  createdAt: z.string(),
  text: z.string(),
  source: z.enum(["auto", "manual-flush"]),
  segments: z.array(transcriptSegmentSchema),
});

export const suggestionSchema = z.object({
  id: z.string(),
  type: suggestionTypeSchema,
  preview: z.string().min(1),
  detailedPromptSeed: z.string().min(1),
  rationale: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
});

export const suggestionBatchSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  basedOnChunkIds: z.array(z.string()),
  suggestions: z.tuple([
    suggestionSchema,
    suggestionSchema,
    suggestionSchema,
  ]),
});

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  createdAt: z.string(),
  text: z.string(),
  source: z.enum(["typed", "suggestion_click", "assistant"]),
  relatedSuggestionId: z.string().optional(),
});

export const chatMessageInputSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export const conversationModeSchema = z.enum([
  "discovery",
  "brainstorming",
  "status_update",
  "problem_solving",
  "planning",
  "decision_making",
  "wrap_up",
]);

export const toneAndPressureSchema = z.enum([
  "collaborative",
  "neutral",
  "skeptical",
  "tense",
  "urgent",
]);

export const userResponseNeedSchema = z.enum([
  "ask_now",
  "answer_now",
  "reframe_now",
  "decide_now",
  "close_now",
  "listen_only",
]);

export const riskSignalSchema = z.enum([
  "factual_uncertainty",
  "misalignment",
  "decision_ambiguity",
  "ownership_gap",
  "timeline_risk",
]);

export const expandedSuggestionAffinitySchema = z.object({
  dominantType: suggestionTypeSchema.nullable(),
  countsByType: z.record(suggestionTypeSchema, z.number()),
});

export const contextMetadataModelSchema = z.object({
  llmSummary: z.string().min(1),
  conversationMode: conversationModeSchema,
  toneAndPressure: toneAndPressureSchema,
  userResponseNeed: userResponseNeedSchema,
  riskSignals: z.array(riskSignalSchema).max(5),
});

export const storedContextMetadataSchema = z.object({
  sessionId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(["ready", "refreshing", "stale", "failed"]),
  basedOnChunkIds: z.array(z.string()),
  llmSummary: z.string(),
  conversationMode: conversationModeSchema,
  toneAndPressure: toneAndPressureSchema,
  userResponseNeed: userResponseNeedSchema,
  expandedSuggestionAffinity: expandedSuggestionAffinitySchema,
  riskSignals: z.array(riskSignalSchema).max(5),
  version: z.number(),
  error: z.string().optional(),
});

export const sessionContextRecordSchema = z.object({
  sessionId: z.string(),
  updatedAt: z.string(),
  transcriptChunks: z.array(transcriptChunkSchema),
  suggestionBatches: z.array(suggestionBatchSchema),
  chatMessages: z.array(chatMessageSchema),
  rollingSummary: z.string(),
});

export const contextMetadataRefreshRequestSchema = z.object({
  sessionId: z.string().min(1),
  apiKey: z.string().min(1),
  rollingSummary: z.string(),
  transcriptChunks: z.array(transcriptChunkSchema),
  suggestionBatches: z.array(suggestionBatchSchema),
  chatMessages: z.array(chatMessageSchema),
});
