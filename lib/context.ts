import type {
  ChatMessage,
  SuggestionBatch,
  TranscriptChunk,
} from "@/types/session";

export function buildSuggestionContext(input: {
  transcriptChunks: TranscriptChunk[];
  suggestionBatches: SuggestionBatch[];
  transcriptLimit: number;
  suggestionBatchLimit?: number;
}) {
  return {
    recentChunks: input.transcriptChunks.slice(-input.transcriptLimit),
    recentSuggestionBatches: input.suggestionBatches.slice(
      0,
      input.suggestionBatchLimit ?? 2,
    ),
  };
}

export function formatTranscriptChunks(chunks: TranscriptChunk[]) {
  return chunks
    .map((chunk) => `[${chunk.startedAt} -> ${chunk.endedAt}] ${chunk.text}`)
    .join("\n");
}

export function formatSuggestionHistory(batches: SuggestionBatch[]) {
  return batches
    .map((batch) =>
      batch.suggestions.map((suggestion) => suggestion.preview).join("\n"),
    )
    .join("\n\n");
}

export function formatChatHistory(messages: ChatMessage[]) {
  return messages.map((message) => `${message.role}: ${message.text}`).join("\n");
}
