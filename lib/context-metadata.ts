import {
  formatSuggestionHistory,
  formatTranscriptChunks,
} from "@/lib/context";
import type {
  ExpandedSuggestionAffinity,
  SessionContextRecord,
  StoredContextMetadata,
  SuggestionType,
} from "@/types/session";

export const suggestionTypes: SuggestionType[] = [
  "question_to_ask",
  "answer_to_give",
  "talking_point",
  "next_step",
  "fact_check",
];

export function createSuggestionTypeCounts(): Record<SuggestionType, number> {
  return {
    question_to_ask: 0,
    answer_to_give: 0,
    talking_point: 0,
    next_step: 0,
    fact_check: 0,
  };
}

export function computeExpandedSuggestionAffinity(
  context: SessionContextRecord,
): ExpandedSuggestionAffinity {
  const countsByType = createSuggestionTypeCounts();
  const suggestionTypeById = new Map<string, SuggestionType>();

  for (const batch of context.suggestionBatches) {
    for (const suggestion of batch.suggestions) {
      suggestionTypeById.set(suggestion.id, suggestion.type);
    }
  }

  for (const message of context.chatMessages) {
    if (message.source !== "suggestion_click" || !message.relatedSuggestionId) {
      continue;
    }

    const suggestionType = suggestionTypeById.get(message.relatedSuggestionId);
    if (suggestionType) {
      countsByType[suggestionType] += 1;
    }
  }

  let dominantType: SuggestionType | null = null;
  let dominantCount = 0;

  for (const suggestionType of suggestionTypes) {
    if (countsByType[suggestionType] > dominantCount) {
      dominantType = suggestionType;
      dominantCount = countsByType[suggestionType];
    }
  }

  return {
    dominantType,
    countsByType,
  };
}

export function formatContextMetadata(
  metadata: StoredContextMetadata | null,
): string {
  if (!metadata) {
    return "None";
  }

  const totalExpandedSelections = suggestionTypes.reduce(
    (sum, suggestionType) =>
      sum + metadata.expandedSuggestionAffinity.countsByType[suggestionType],
    0,
  );
  const dominantType = metadata.expandedSuggestionAffinity.dominantType;
  const dominantTypeCount = dominantType
    ? metadata.expandedSuggestionAffinity.countsByType[dominantType]
    : 0;
  const dominantTypeShare =
    totalExpandedSelections > 0
      ? Math.round((dominantTypeCount / totalExpandedSelections) * 100)
      : 0;
  const preferredType =
    dominantType && dominantTypeShare > 75 ? dominantType : "none";

  return [
    `SUMMARY: ${metadata.llmSummary || "None"}`,
    `MODE: ${metadata.conversationMode}`,
    `NEED: ${metadata.userResponseNeed}`,
    `TONE: ${metadata.toneAndPressure}`,
    `PREFERRED_TYPE: ${preferredType}`,
    `PREFERRED_TYPE_SHARE: ${dominantTypeShare}%`,
    `RISKS: ${metadata.riskSignals.join(", ") || "none"}`,
  ].join("\n");
}

export function formatChatContextMetadata(
  metadata: StoredContextMetadata | null,
): string {
  if (!metadata) {
    return "None";
  }

  const lines = [
    `SUMMARY: ${metadata.llmSummary || "None"}`,
    `MODE: ${metadata.conversationMode}`,
    `NEED: ${metadata.userResponseNeed}`,
    `TONE: ${metadata.toneAndPressure}`,
  ];

  if (metadata.riskSignals.length) {
    lines.push(`RISKS: ${metadata.riskSignals.join(", ")}`);
  }

  return lines.join("\n");
}

function formatExpandedSuggestionAffinity(
  affinity: ExpandedSuggestionAffinity,
): string {
  const usedCounts = suggestionTypes
    .filter((suggestionType) => affinity.countsByType[suggestionType] > 0)
    .map((suggestionType) => `${suggestionType}: ${affinity.countsByType[suggestionType]}`);

  return [
    `DOMINANT_EXPANDED_TYPE: ${affinity.dominantType ?? "none"}`,
    `EXPANDED_TYPE_COUNTS: ${usedCounts.join(", ") || "none"}`,
  ].join("\n");
}

export function formatMetadataRefreshContent(
  context: SessionContextRecord,
  affinity: ExpandedSuggestionAffinity,
  currentSummary: string,
): string {
  const recentTranscript = formatTranscriptChunks(context.transcriptChunks.slice(-6));
  const recentSuggestions = formatSuggestionHistory(
    context.suggestionBatches.slice(0, 3),
  );

  return [
    `CURRENT_SUMMARY:\n${currentSummary || "None"}`,
    `ROLLING_SUMMARY:\n${context.rollingSummary || "None"}`,
    `RECENT_TRANSCRIPT:\n${recentTranscript || "None"}`,
    `RECENT_SUGGESTION_BATCHES:\n${recentSuggestions || "None"}`,
    formatExpandedSuggestionAffinity(affinity),
  ].join("\n\n");
}
