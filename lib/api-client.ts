import { parseApiError } from "@/lib/errors";
import type {
  ChatRequest,
  ContextMetadataResponse,
  ContextMetadataRefreshRequest,
  ContextMetadataRefreshResponse,
  SuggestionsRequest,
  TranscribeRequest,
  SuggestionsResponse,
  TranscribeResponse,
} from "@/types/api";

export async function transcribeChunk(
  request: TranscribeRequest,
): Promise<TranscribeResponse> {
  const formData = new FormData();
  formData.set(
    "file",
    new File([request.blob], "chunk.webm", { type: request.blob.type }),
  );
  formData.set("apiKey", request.apiKey);
  formData.set("language", request.language);
  formData.set("startedAt", request.startedAt);
  formData.set("endedAt", request.endedAt);
  formData.set("source", request.source);

  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return (await response.json()) as TranscribeResponse;
}

export async function loadSuggestions(
  request: SuggestionsRequest,
): Promise<SuggestionsResponse> {
  const response = await fetch("/api/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return (await response.json()) as SuggestionsResponse;
}

export async function streamChatResponse(
  request: ChatRequest,
  onToken: (token: string) => void,
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok || !response.body) {
    await parseApiError(response);
  }

  const body = response.body;
  if (!body) {
    throw new Error("Chat response body is missing");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    onToken(decoder.decode(value, { stream: true }));
  }
}

export async function refreshContextMetadata(
  request: ContextMetadataRefreshRequest,
): Promise<ContextMetadataRefreshResponse> {
  const response = await fetch("/api/context-metadata/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return (await response.json()) as ContextMetadataRefreshResponse;
}

export async function getContextMetadata(
  sessionId: string,
): Promise<ContextMetadataResponse> {
  const response = await fetch(
    `/api/context-metadata?sessionId=${encodeURIComponent(sessionId)}`,
  );

  if (!response.ok) {
    await parseApiError(response);
  }

  return (await response.json()) as ContextMetadataResponse;
}
