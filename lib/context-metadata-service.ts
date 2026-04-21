import { createGroqClient } from "@/lib/groq";
import { DEFAULT_CONTEXT_METADATA_PROMPT } from "@/lib/prompts";
import {
  clearInFlightContextMetadataRefresh,
  consumeQueuedContextMetadataRefresh,
  getLatestSessionApiKey,
  getSessionContext,
  getStoredContextMetadata,
  isContextMetadataRefreshInFlight,
  markContextMetadataQueued,
  setInFlightContextMetadataRefresh,
  setLatestSessionApiKey,
  updateContextMetadataStatus,
  upsertContextMetadata,
} from "@/lib/backend-session-store";
import {
  computeExpandedSuggestionAffinity,
  formatMetadataRefreshContent,
} from "@/lib/context-metadata";
import { contextMetadataModelSchema } from "@/lib/schemas";

const contextMetadataResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    llmSummary: {
      type: "string",
    },
    conversationMode: {
      type: "string",
      enum: [
        "discovery",
        "brainstorming",
        "status_update",
        "problem_solving",
        "planning",
        "decision_making",
        "wrap_up",
      ],
    },
    toneAndPressure: {
      type: "string",
      enum: ["collaborative", "neutral", "skeptical", "tense", "urgent"],
    },
    userResponseNeed: {
      type: "string",
      enum: [
        "ask_now",
        "answer_now",
        "reframe_now",
        "decide_now",
        "close_now",
        "listen_only",
      ],
    },
    riskSignals: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "factual_uncertainty",
          "misalignment",
          "decision_ambiguity",
          "ownership_gap",
          "timeline_risk",
        ],
      },
      maxItems: 5,
    },
  },
  required: [
    "llmSummary",
    "conversationMode",
    "toneAndPressure",
    "userResponseNeed",
    "riskSignals",
  ],
} as const;

type ContextMetadataCompletion = {
  choices: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

async function runContextMetadataRefresh(sessionId: string, apiKey: string) {
  const sessionContext = getSessionContext(sessionId);
  if (!sessionContext || !sessionContext.transcriptChunks.length) {
    updateContextMetadataStatus(
      sessionId,
      "failed",
      "Session context is missing for metadata refresh",
    );
    return;
  }

  const existingMetadata = getStoredContextMetadata(sessionId);
  const expandedSuggestionAffinity =
    computeExpandedSuggestionAffinity(sessionContext);

  try {
    const groq = createGroqClient(apiKey);
    const completion = (await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      temperature: 0.1,
      messages: [
        { role: "system", content: DEFAULT_CONTEXT_METADATA_PROMPT },
        {
          role: "user",
          content: formatMetadataRefreshContent(
            sessionContext,
            expandedSuggestionAffinity,
            existingMetadata?.llmSummary ?? "",
          ),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "context_metadata",
          strict: true,
          schema: contextMetadataResponseSchema,
        },
      },
    })) as ContextMetadataCompletion;

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Context metadata model returned an empty response");
    }

    const payload = contextMetadataModelSchema.parse(JSON.parse(content) as object);
    const timestamp = new Date().toISOString();

    upsertContextMetadata({
      sessionId,
      createdAt: existingMetadata?.createdAt ?? timestamp,
      updatedAt: timestamp,
      status: "ready",
      basedOnChunkIds: sessionContext.transcriptChunks.slice(-6).map((chunk) => chunk.id),
      llmSummary: payload.llmSummary,
      conversationMode: payload.conversationMode,
      toneAndPressure: payload.toneAndPressure,
      userResponseNeed: payload.userResponseNeed,
      expandedSuggestionAffinity,
      riskSignals: payload.riskSignals,
      version: (existingMetadata?.version ?? 0) + 1,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Context metadata refresh failed";

    if (existingMetadata) {
      upsertContextMetadata({
        ...existingMetadata,
        updatedAt: new Date().toISOString(),
        status: "failed",
        error: message,
      });
      return;
    }

    updateContextMetadataStatus(sessionId, "failed", message);
  }
}

export function enqueueContextMetadataRefresh(sessionId: string, apiKey: string) {
  setLatestSessionApiKey(sessionId, apiKey);

  if (isContextMetadataRefreshInFlight(sessionId)) {
    markContextMetadataQueued(sessionId);
    updateContextMetadataStatus(sessionId, "stale");
    return "queued" as const;
  }

  updateContextMetadataStatus(sessionId, "refreshing");

  const refreshPromise = runContextMetadataRefresh(sessionId, apiKey).finally(() => {
    clearInFlightContextMetadataRefresh(sessionId);

    if (!consumeQueuedContextMetadataRefresh(sessionId)) {
      return;
    }

    const latestApiKey = getLatestSessionApiKey(sessionId);
    if (latestApiKey) {
      enqueueContextMetadataRefresh(sessionId, latestApiKey);
    }
  });

  setInFlightContextMetadataRefresh(sessionId, refreshPromise);
  return "started" as const;
}
