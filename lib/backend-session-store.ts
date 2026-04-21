import { storedContextMetadataSchema } from "@/lib/schemas";
import type {
  ContextMetadataStatus,
  SessionContextRecord,
  StoredContextMetadata,
} from "@/types/session";

const sessionContexts = new Map<string, SessionContextRecord>();
const contextMetadataRecords = new Map<string, StoredContextMetadata>();
const inFlightMetadataRefreshes = new Map<string, Promise<void>>();
const queuedMetadataRefreshes = new Set<string>();
const latestApiKeys = new Map<string, string>();

export function upsertSessionContext(context: SessionContextRecord) {
  sessionContexts.set(context.sessionId, context);
}

export function getSessionContext(sessionId: string) {
  return sessionContexts.get(sessionId) ?? null;
}

export function getStoredContextMetadata(sessionId: string) {
  const metadata = contextMetadataRecords.get(sessionId) ?? null;
  if (!metadata) {
    return null;
  }
  return storedContextMetadataSchema.parse(metadata);
}

export function upsertContextMetadata(metadata: StoredContextMetadata) {
  contextMetadataRecords.set(metadata.sessionId, metadata);
  return metadata;
}

export function isContextMetadataRefreshInFlight(sessionId: string) {
  return inFlightMetadataRefreshes.has(sessionId);
}

export function markContextMetadataQueued(sessionId: string) {
  queuedMetadataRefreshes.add(sessionId);
}

export function consumeQueuedContextMetadataRefresh(sessionId: string) {
  const wasQueued = queuedMetadataRefreshes.has(sessionId);
  queuedMetadataRefreshes.delete(sessionId);
  return wasQueued;
}

export function setLatestSessionApiKey(sessionId: string, apiKey: string) {
  latestApiKeys.set(sessionId, apiKey);
}

export function getLatestSessionApiKey(sessionId: string) {
  return latestApiKeys.get(sessionId) ?? null;
}

export function setInFlightContextMetadataRefresh(
  sessionId: string,
  refreshPromise: Promise<void>,
) {
  inFlightMetadataRefreshes.set(sessionId, refreshPromise);
}

export function clearInFlightContextMetadataRefresh(sessionId: string) {
  inFlightMetadataRefreshes.delete(sessionId);
}

export function updateContextMetadataStatus(
  sessionId: string,
  status: ContextMetadataStatus,
  error?: string,
) {
  const existing = getStoredContextMetadata(sessionId);
  if (existing) {
    upsertContextMetadata({
      ...existing,
      status,
      updatedAt: new Date().toISOString(),
      error,
    });
    return;
  }

  upsertContextMetadata({
    sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status,
    basedOnChunkIds: [],
    llmSummary: "",
    conversationMode: "status_update",
    toneAndPressure: "neutral",
    userResponseNeed: "listen_only",
    expandedSuggestionAffinity: {
      dominantType: null,
      countsByType: {
        question_to_ask: 0,
        answer_to_give: 0,
        talking_point: 0,
        next_step: 0,
        fact_check: 0,
      },
    },
    riskSignals: [],
    version: 0,
    error,
  });
}
