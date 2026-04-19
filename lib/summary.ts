import type { TranscriptChunk } from "@/types/session";

export function buildRollingSummary(chunks: TranscriptChunk[]) {
  const recent = chunks.slice(-6).map((chunk) => chunk.text.trim()).filter(Boolean);
  if (!recent.length) {
    return "";
  }
  const combined = recent.join(" ");
  return combined.length > 600 ? `${combined.slice(0, 597)}...` : combined;
}
