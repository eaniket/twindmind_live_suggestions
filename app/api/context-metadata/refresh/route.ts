import { NextRequest, NextResponse } from "next/server";
import { enqueueContextMetadataRefresh } from "@/lib/context-metadata-service";
import {
  contextMetadataRefreshRequestSchema,
  sessionContextRecordSchema,
} from "@/lib/schemas";
import { upsertSessionContext } from "@/lib/backend-session-store";

export async function POST(request: NextRequest) {
  const input = contextMetadataRefreshRequestSchema.parse(await request.json());

  upsertSessionContext(
    sessionContextRecordSchema.parse({
      sessionId: input.sessionId,
      updatedAt: new Date().toISOString(),
      transcriptChunks: input.transcriptChunks,
      suggestionBatches: input.suggestionBatches,
      chatMessages: input.chatMessages,
      rollingSummary: input.rollingSummary,
    }),
  );

  const status = enqueueContextMetadataRefresh(input.sessionId, input.apiKey);

  return NextResponse.json({ status }, { status: 202 });
}
