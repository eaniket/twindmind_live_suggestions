# TwinMind Implementation Plan

## Goal

Build a web app that:

- captures mic audio in 30-second chunks
- transcribes with Groq `whisper-large-v3`
- generates exactly 3 live suggestions with Groq `openai/gpt-oss-120b`
- lets the user click a suggestion to get a streamed detailed answer
- supports free-form chat
- exports the full in-memory session

This plan assumes a single-repo Next.js + TypeScript implementation and is optimized for the assignment rubric, not production scale.

## Proposed Stack

- Next.js 15 App Router
- TypeScript
- React
- Zod
- `groq-sdk`
- optional Zustand for client state
- CSS modules or Tailwind

## Project Structure

```text
app/
  layout.tsx
  page.tsx
  globals.css
  api/
    transcribe/route.ts
    suggestions/route.ts
    chat/route.ts
components/
  app-shell.tsx
  transcript-panel.tsx
  suggestions-panel.tsx
  chat-panel.tsx
  settings-dialog.tsx
  mic-button.tsx
lib/
  groq.ts
  prompts.ts
  context.ts
  export-session.ts
  time.ts
  stream.ts
types/
  session.ts
  api.ts
```

## Build Order

Implement in this order:

1. scaffold the Next.js app and recreate the 3-column layout
2. define shared types and Zod schemas
3. build session state and settings management
4. implement microphone capture and 30-second chunking
5. implement `/api/transcribe`
6. render transcript chunks and auto-scroll
7. implement `/api/suggestions` with strict JSON schema output
8. render suggestion batches newest-first
9. implement `/api/chat` with streaming
10. wire suggestion click to chat
11. implement manual refresh with recorder flush
12. add export
13. tune prompts and context windows

## Phase 1: App Shell

The first milestone is a functional UI skeleton that matches `mockup.html`.

### `app/page.tsx`

```tsx
import { AppShell } from "@/components/app-shell";

export default function Page() {
  return <AppShell />;
}
```

### `components/app-shell.tsx`

```tsx
"use client";

import { TranscriptPanel } from "./transcript-panel";
import { SuggestionsPanel } from "./suggestions-panel";
import { ChatPanel } from "./chat-panel";
import { SettingsDialog } from "./settings-dialog";
import { useSessionStore } from "@/lib/session-store";

export function AppShell() {
  const isSettingsOpen = useSessionStore((s) => s.isSettingsOpen);

  return (
    <main className="app-shell">
      <header className="topbar">
        <h1>TwinMind Live Suggestions</h1>
        <SettingsDialog open={isSettingsOpen} />
      </header>

      <section className="layout">
        <TranscriptPanel />
        <SuggestionsPanel />
        <ChatPanel />
      </section>
    </main>
  );
}
```

### Layout Notes

- keep the same visual information hierarchy as the mockup
- prioritize readable status states over decoration
- make each column independently scrollable
- put the export button either in the transcript column header or top bar

## Phase 2: Shared Types and Schemas

Define the types first so the rest of the app is stable.

### `types/session.ts`

```ts
export type SuggestionType =
  | "question_to_ask"
  | "talking_point"
  | "answer"
  | "fact_check";

export type TranscriptChunk = {
  id: string;
  startedAt: string;
  endedAt: string;
  createdAt: string;
  text: string;
  source: "auto" | "manual-flush";
  segments: Array<{
    startSec: number;
    endSec: number;
    text: string;
  }>;
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
  chatContextChunkCount: number;
  includeChatInSuggestions: boolean;
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
};
```

### `lib/schemas.ts`

Use Zod both for request validation and for model output parsing.

```ts
import { z } from "zod";

export const suggestionSchema = z.object({
  id: z.string(),
  type: z.enum(["question_to_ask", "talking_point", "answer", "fact_check"]),
  preview: z.string(),
  detailedPromptSeed: z.string(),
  rationale: z.string(),
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
```

## Phase 3: Client Session State

This app is single-session. Keep state client-side.

### `lib/session-store.ts`

```ts
import { create } from "zustand";
import type { SessionState, TranscriptChunk, SuggestionBatch, ChatMessage } from "@/types/session";

type Store = SessionState & {
  isSettingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  addTranscriptChunk: (chunk: TranscriptChunk) => void;
  addSuggestionBatch: (batch: SuggestionBatch) => void;
  addChatMessage: (message: ChatMessage) => void;
  updateLastAssistantMessage: (append: string) => void;
  setFlags: (patch: Partial<Pick<SessionState, "isRecording" | "isTranscribing" | "isGeneratingSuggestions" | "isChatStreaming">>) => void;
};

export const useSessionStore = create<Store>((set) => ({
  startedAt: new Date().toISOString(),
  transcriptChunks: [],
  suggestionBatches: [],
  chatMessages: [],
  rollingSummary: "",
  settings: {
    groqApiKey: "",
    language: "en",
    autoRefreshSeconds: 30,
    suggestionContextChunkCount: 4,
    chatContextChunkCount: 8,
    includeChatInSuggestions: true,
    suggestionPrompt: "",
    detailedAnswerPrompt: "",
    chatPrompt: "",
  },
  isRecording: false,
  isTranscribing: false,
  isGeneratingSuggestions: false,
  isChatStreaming: false,
  isSettingsOpen: false,
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  addTranscriptChunk: (chunk) =>
    set((state) => ({ transcriptChunks: [...state.transcriptChunks, chunk] })),
  addSuggestionBatch: (batch) =>
    set((state) => ({ suggestionBatches: [batch, ...state.suggestionBatches] })),
  addChatMessage: (message) =>
    set((state) => ({ chatMessages: [...state.chatMessages, message] })),
  updateLastAssistantMessage: (append) =>
    set((state) => {
      const next = [...state.chatMessages];
      const last = next.at(-1);
      if (!last || last.role !== "assistant") return state;
      last.text += append;
      return { chatMessages: next };
    }),
  setFlags: (patch) => set(patch),
}));
```

### Storage Strategy

- keep transcript, suggestions, and chat in memory
- keep settings in `sessionStorage`
- restore settings on first client mount

## Phase 4: Microphone Capture

This is the core frontend workflow. Use `MediaRecorder`.

### `lib/audio-recorder.ts`

```ts
type RecorderController = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  flush: () => Promise<Blob | null>;
};

export function createChunkRecorder(
  onChunk: (blob: Blob, meta: { startedAt: string; endedAt: string; source: "auto" | "manual-flush" }) => Promise<void>,
  chunkMs = 30_000
): RecorderController {
  let stream: MediaStream | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let startedAt = "";
  let timeoutId: number | null = null;
  let pendingResolve: ((blob: Blob | null) => void) | null = null;

  const start = async () => {
    stream ??= await navigator.mediaDevices.getUserMedia({ audio: true });
    startedAt = new Date().toISOString();

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });

    const chunks: BlobPart[] = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const endedAt = new Date().toISOString();
      if (pendingResolve) {
        pendingResolve(blob);
        pendingResolve = null;
      } else if (blob.size > 0) {
        await onChunk(blob, { startedAt, endedAt, source: "auto" });
      }
    };

    mediaRecorder.start();
    timeoutId = window.setTimeout(() => mediaRecorder?.stop(), chunkMs);
  };

  const stop = async () => {
    if (timeoutId) window.clearTimeout(timeoutId);
    mediaRecorder?.stop();
  };

  const flush = async () => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return null;
    if (timeoutId) window.clearTimeout(timeoutId);
    return await new Promise<Blob | null>((resolve) => {
      pendingResolve = resolve;
      mediaRecorder?.stop();
    });
  };

  return { start, stop, flush };
}
```

### Important Recorder Rules

- when auto chunk completes, immediately transcribe then start the next chunk
- when manual refresh is clicked during recording, call `flush()`
- never run overlapping transcribe requests for the same chunk

## Phase 5: Transcription Endpoint

This should accept multipart form data and proxy to Groq.

### `lib/groq.ts`

```ts
import Groq from "groq-sdk";

export function createGroqClient(apiKey: string) {
  return new Groq({ apiKey });
}
```

### `app/api/transcribe/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { createGroqClient } from "@/lib/groq";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const apiKey = String(form.get("apiKey") ?? "");
  const language = String(form.get("language") ?? "en");
  const startedAt = String(form.get("startedAt") ?? "");
  const endedAt = String(form.get("endedAt") ?? "");
  const source = String(form.get("source") ?? "auto") as "auto" | "manual-flush";
  const file = form.get("file");

  if (!apiKey || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing apiKey or audio file" }, { status: 400 });
  }

  const groq = createGroqClient(apiKey);

  const result = await groq.audio.transcriptions.create({
    file,
    model: "whisper-large-v3",
    language,
    response_format: "verbose_json",
    temperature: 0,
    timestamp_granularities: ["segment"],
  });

  return NextResponse.json({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    startedAt,
    endedAt,
    source,
    text: result.text ?? "",
    segments: (result.segments ?? []).map((segment) => ({
      startSec: segment.start ?? 0,
      endSec: segment.end ?? 0,
      text: segment.text ?? "",
    })),
  });
}
```

### Client Transcribe Helper

```ts
export async function transcribeChunk(input: {
  blob: Blob;
  apiKey: string;
  language: string;
  startedAt: string;
  endedAt: string;
  source: "auto" | "manual-flush";
}) {
  const form = new FormData();
  form.set("file", new File([input.blob], "chunk.webm", { type: input.blob.type }));
  form.set("apiKey", input.apiKey);
  form.set("language", input.language);
  form.set("startedAt", input.startedAt);
  form.set("endedAt", input.endedAt);
  form.set("source", input.source);

  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) throw new Error("Transcription failed");
  return res.json();
}
```

## Phase 6: Transcript UI

After transcription succeeds:

- append the chunk
- auto-scroll transcript body
- trigger live suggestions

### Transcript panel auto-scroll

```tsx
const bodyRef = useRef<HTMLDivElement | null>(null);
const transcriptChunks = useSessionStore((s) => s.transcriptChunks);

useEffect(() => {
  const el = bodyRef.current;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}, [transcriptChunks]);
```

## Phase 7: Suggestion Context Builder

Do not send the entire transcript. Use a bounded context window.

### `lib/context.ts`

```ts
import type { TranscriptChunk, SuggestionBatch, ChatMessage } from "@/types/session";

export function buildSuggestionContext(input: {
  transcriptChunks: TranscriptChunk[];
  suggestionBatches: SuggestionBatch[];
  chatMessages: ChatMessage[];
  transcriptLimit: number;
  includeChat: boolean;
}) {
  const recentChunks = input.transcriptChunks.slice(-input.transcriptLimit);
  const recentSuggestionBatches = input.suggestionBatches.slice(0, 2);
  const recentChat = input.includeChat ? input.chatMessages.slice(-4) : [];

  return {
    recentChunks,
    recentSuggestionBatches,
    recentChat,
  };
}
```

### Transcript serialization

```ts
export function formatTranscriptChunks(chunks: TranscriptChunk[]) {
  return chunks
    .map((chunk) => `[${chunk.startedAt} -> ${chunk.endedAt}] ${chunk.text}`)
    .join("\n");
}
```

## Phase 8: Suggestion Endpoint

Use strict structured output. This is the cleanest way to guarantee exactly 3 cards.

### `lib/prompts.ts`

```ts
export const DEFAULT_SUGGESTION_PROMPT = `
You are an always-on AI meeting copilot.

Your job is to produce exactly 3 useful live suggestions based on the most recent meeting context.

Rules:
- Optimize for immediate usefulness in the next 10-30 seconds.
- Suggestions must be specific to the transcript.
- The preview text must be useful even if the user never clicks it.
- Prefer diversity across the 3 suggestions when the transcript supports it.
- Use fact_check only when there is a plausible risk of an incorrect or questionable claim.
- Avoid generic filler.
- Do not repeat recent suggestion batches unless the transcript materially changes.
`;
```

### `app/api/suggestions/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { createGroqClient } from "@/lib/groq";
import { suggestionBatchSchema } from "@/lib/schemas";
import { DEFAULT_SUGGESTION_PROMPT } from "@/lib/prompts";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { apiKey, rollingSummary, transcriptText, recentSuggestions, basedOnChunkIds, prompt } = body;

  if (!apiKey || !transcriptText) {
    return NextResponse.json({ error: "Missing apiKey or transcriptText" }, { status: 400 });
  }

  const groq = createGroqClient(apiKey);

  const response = await groq.chat.completions.create({
    model: "openai/gpt-oss-120b",
    messages: [
      {
        role: "system",
        content: prompt || DEFAULT_SUGGESTION_PROMPT,
      },
      {
        role: "user",
        content: [
          `ROLLING_SUMMARY:\n${rollingSummary || "None"}`,
          `RECENT_TRANSCRIPT:\n${transcriptText}`,
          `RECENT_SUGGESTION_BATCHES:\n${recentSuggestions || "None"}`,
          "Return exactly 3 suggestions.",
        ].join("\n\n"),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "suggestion_batch",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            createdAt: { type: "string" },
            basedOnChunkIds: {
              type: "array",
              items: { type: "string" },
            },
            suggestions: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  type: {
                    type: "string",
                    enum: ["question_to_ask", "talking_point", "answer", "fact_check"],
                  },
                  preview: { type: "string" },
                  detailedPromptSeed: { type: "string" },
                  rationale: { type: "string" },
                  confidence: {
                    type: "string",
                    enum: ["high", "medium", "low"],
                  },
                },
                required: ["id", "type", "preview", "detailedPromptSeed", "rationale", "confidence"],
              },
            },
          },
          required: ["id", "createdAt", "basedOnChunkIds", "suggestions"],
        },
      },
    },
  });

  const raw = JSON.parse(response.choices[0]?.message?.content ?? "{}");
  const parsed = suggestionBatchSchema.parse({
    ...raw,
    id: raw.id || randomUUID(),
    createdAt: raw.createdAt || new Date().toISOString(),
    basedOnChunkIds: raw.basedOnChunkIds?.length ? raw.basedOnChunkIds : basedOnChunkIds ?? [],
  });

  return NextResponse.json(parsed);
}
```

### Client suggestion loader

```ts
export async function loadSuggestions(payload: {
  apiKey: string;
  rollingSummary: string;
  transcriptText: string;
  recentSuggestions: string;
  basedOnChunkIds: string[];
  prompt: string;
}) {
  const res = await fetch("/api/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error("Suggestions failed");
  return res.json();
}
```

## Phase 9: Suggestion UI

The user should get value before click.

### `components/suggestions-panel.tsx`

```tsx
"use client";

import { useSessionStore } from "@/lib/session-store";

export function SuggestionsPanel() {
  const suggestionBatches = useSessionStore((s) => s.suggestionBatches);
  const onSuggestionClick = useSuggestionClick();

  return (
    <section className="panel">
      <header>Live Suggestions</header>
      <div className="panel-body">
        {suggestionBatches.map((batch, batchIndex) => (
          <div key={batch.id}>
            {batch.suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                className={batchIndex === 0 ? "suggestion-card fresh" : "suggestion-card stale"}
                onClick={() => onSuggestionClick(suggestion)}
              >
                <div className="tag">{suggestion.type}</div>
                <div>{suggestion.preview}</div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
```

## Phase 10: Chat Endpoint With Streaming

Suggestions are structured and non-streaming. Chat should stream.

### `app/api/chat/route.ts`

```ts
import { NextRequest } from "next/server";
import { createGroqClient } from "@/lib/groq";
import { DEFAULT_CHAT_PROMPT } from "@/lib/prompts";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { apiKey, chatMessages, transcriptText, rollingSummary, prompt, userMessage } = body;

  const groq = createGroqClient(apiKey);

  const stream = await groq.chat.completions.create({
    model: "openai/gpt-oss-120b",
    stream: true,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: prompt || DEFAULT_CHAT_PROMPT,
      },
      {
        role: "user",
        content: [
          `ROLLING_SUMMARY:\n${rollingSummary || "None"}`,
          `TRANSCRIPT_CONTEXT:\n${transcriptText}`,
          `USER_REQUEST:\n${userMessage}`,
        ].join("\n\n"),
      },
      ...chatMessages,
    ],
  });

  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content;
          if (!token) continue;
          controller.enqueue(encoder.encode(token));
        }
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    }
  );
}
```

### Client streaming reader

```ts
export async function streamChatResponse(payload: Record<string, unknown>, onToken: (token: string) => void) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) throw new Error("Chat failed");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onToken(decoder.decode(value, { stream: true }));
  }
}
```

## Phase 11: Suggestion Click Flow

Clicking a suggestion should:

1. add the suggestion preview as a user message
2. create an empty assistant placeholder
3. stream the assistant response into that placeholder

### `useSuggestionClick`

```ts
import { useSessionStore } from "@/lib/session-store";
import { streamChatResponse } from "@/lib/chat-client";
import { formatTranscriptChunks } from "@/lib/context";

export function useSuggestionClick() {
  const store = useSessionStore();

  return async (suggestion: {
    id: string;
    preview: string;
    detailedPromptSeed: string;
    type: string;
  }) => {
    store.addChatMessage({
      id: crypto.randomUUID(),
      role: "user",
      createdAt: new Date().toISOString(),
      text: suggestion.preview,
      source: "suggestion_click",
      relatedSuggestionId: suggestion.id,
    });

    store.addChatMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      createdAt: new Date().toISOString(),
      text: "",
      source: "assistant",
      relatedSuggestionId: suggestion.id,
    });

    store.setFlags({ isChatStreaming: true });

    try {
      await streamChatResponse(
        {
          apiKey: store.settings.groqApiKey,
          rollingSummary: store.rollingSummary,
          transcriptText: formatTranscriptChunks(
            store.transcriptChunks.slice(-store.settings.chatContextChunkCount)
          ),
          chatMessages: store.chatMessages.map((m) => ({
            role: m.role,
            content: m.text,
          })),
          userMessage: [
            `Suggestion type: ${suggestion.type}`,
            `Suggestion preview: ${suggestion.preview}`,
            `Expand on this for the user: ${suggestion.detailedPromptSeed}`,
          ].join("\n"),
          prompt: store.settings.detailedAnswerPrompt,
        },
        (token) => store.updateLastAssistantMessage(token)
      );
    } finally {
      store.setFlags({ isChatStreaming: false });
    }
  };
}
```

## Phase 12: Manual Refresh Logic

This is where many implementations fail the PRD.

### Refresh behavior

If recording is active:

- flush the in-progress recorder
- transcribe the partial chunk as `manual-flush`
- append transcript
- run suggestions
- restart a fresh 30-second recorder window

If recording is inactive:

- run suggestions using current transcript

### Refresh handler

```ts
async function handleRefresh() {
  if (store.isTranscribing || store.isGeneratingSuggestions) return;

  if (store.isRecording) {
    const blob = await recorder.flush();
    if (blob && blob.size > 0) {
      await transcribeAndAppend(blob, "manual-flush");
    }
    await generateSuggestions();
    await recorder.start();
    return;
  }

  await generateSuggestions();
}
```

## Phase 13: Export

The export should be simple and inspectable.

### `lib/export-session.ts`

```ts
import type { SessionState } from "@/types/session";

export function buildExportPayload(state: SessionState) {
  return {
    session: {
      startedAt: state.startedAt,
      endedAt: new Date().toISOString(),
      settings: {
        language: state.settings.language,
        autoRefreshSeconds: state.settings.autoRefreshSeconds,
        suggestionContextChunkCount: state.settings.suggestionContextChunkCount,
        chatContextChunkCount: state.settings.chatContextChunkCount,
      },
    },
    transcriptChunks: state.transcriptChunks,
    suggestionBatches: state.suggestionBatches,
    chatMessages: state.chatMessages,
    rollingSummary: state.rollingSummary,
  };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

## Phase 14: Default Prompts

Ship defaults that are already strong, then make them editable in settings.

### Default chat prompt

```ts
export const DEFAULT_CHAT_PROMPT = `
You are a live meeting copilot.

Answer the user's question directly and practically.

Rules:
- Use the transcript context when relevant.
- Be concise by default.
- If the user clicked a live suggestion, expand it into something more useful and specific.
- Give wording the user can say out loud when appropriate.
- Do not invent facts that are not grounded in the transcript or generally reliable knowledge.
`;
```

### Prompt editing UX

The settings dialog should expose:

- Groq API key
- live suggestion prompt
- detailed answer prompt
- chat prompt
- suggestion context chunk count
- chat context chunk count
- include chat in suggestions toggle

## Phase 15: Error Handling

Handle these explicitly:

- missing API key
- browser without `MediaRecorder`
- mic permission denied
- empty audio blob
- transcription 4xx/5xx
- suggestion schema parse failure
- chat stream interruption
- duplicate refresh clicks
- rate limit errors

### Example API error helper

```ts
export async function parseApiError(res: Response) {
  let message = "Request failed";
  try {
    const body = await res.json();
    message = body.error || message;
  } catch {
    // ignore
  }
  throw new Error(message);
}
```

## Phase 16: Styling Priorities

Do not spend time inventing a new layout. Match the mockup.

Focus on:

- clear column headers
- visible mic state
- readable transcript timestamps
- suggestion freshness vs staleness styling
- smooth auto-scroll
- fast-feeling chat stream

## Phase 17: QA Checklist

Run this before calling it done:

1. start recording and confirm transcript appears after the first chunk
2. confirm suggestion batch appears immediately after transcription
3. confirm newest suggestion batch renders at the top
4. click a suggestion and confirm chat streams
5. send a typed chat question and confirm it uses session context
6. hit refresh while recording and confirm the partial chunk is flushed first
7. export the session and inspect the JSON
8. reload the page and confirm session clears but settings behavior matches your choice

## Phase 18: Stretch Improvements

Only do these after the core loop works:

- rolling summary memory updated every 2 chunks
- smarter anti-repetition by including last 2 batches in the prompt
- confidence-based styling for weak suggestions
- transcript chunk status markers like `recording`, `transcribing`, `complete`
- lightweight latency logging in dev mode

## Recommended First Commit Scope

The first meaningful implementation milestone should include:

- app shell
- shared types
- session store
- settings dialog
- mic button UI
- `MediaRecorder` integration
- `/api/transcribe`
- transcript rendering

After that, add suggestions. After suggestions are stable, add streamed chat.

## Final Advice

The quality bar for this assignment is not "build a general AI workspace". It is:

- dependable transcription
- excellent context selection
- exactly 3 useful live suggestions
- stronger detailed answers on click
- clean code and a defendable architecture

Keep the implementation compact and explicit.

## Detailed Todo List

All phases below are completed.

## Post-Implementation Updates

### Update 1 - Completed

- add a refresh icon to the reload suggestions button

### Update 2 - Completed

- render assistant chat responses as formatted markdown instead of plain markdown text

Use this as the working checklist while building. The order matches the plan above.

### Phase 1: App Shell - Completed

- initialize the Next.js app with TypeScript and App Router
- install baseline dependencies:
  - `groq-sdk`
  - `zod`
  - `zustand` if using it
- create the top-level folder structure from the plan
- add `app/page.tsx`
- add `app/layout.tsx`
- add `app/globals.css`
- recreate the 3-column layout from `mockup.html`
- create placeholder components:
  - `app-shell.tsx`
  - `transcript-panel.tsx`
  - `suggestions-panel.tsx`
  - `chat-panel.tsx`
  - `settings-dialog.tsx`
  - `mic-button.tsx`
- verify the app renders with:
  - top bar
  - left transcript column
  - middle suggestions column
  - right chat column
- make each panel independently scrollable
- match the main spacing and hierarchy of the mockup before adding logic

### Phase 2: Shared Types and Schemas - Completed

- create `types/session.ts`
- define:
  - `SuggestionType`
  - `TranscriptChunk`
  - `Suggestion`
  - `SuggestionBatch`
  - `ChatMessage`
  - `SessionSettings`
  - `SessionState`
- create `lib/schemas.ts`
- define Zod schemas for:
  - suggestion
  - suggestion batch
  - any request payloads you want to validate on the server
- verify type names and schema names line up exactly
- ensure the suggestion schema enforces exactly 3 suggestions
- confirm the schema shape matches what the frontend renderer expects

### Phase 3: Client Session State - Completed

- choose state strategy:
  - Zustand
  - or plain React context plus hooks
- create `lib/session-store.ts`
- add state for:
  - transcript chunks
  - suggestion batches
  - chat messages
  - rolling summary
  - settings
  - recording and loading flags
- add actions for:
  - adding transcript chunk
  - adding suggestion batch
  - adding chat message
  - updating streamed assistant message
  - opening and closing settings
  - updating flags
- decide settings persistence behavior
- add `sessionStorage` read on first client mount
- add `sessionStorage` write when settings change
- decide whether the Groq API key should persist for the tab only
- verify store updates cause expected UI rerenders

### Phase 4: Settings UI - Completed

- build the settings dialog component
- add fields for:
  - Groq API key
  - transcription language
  - auto-refresh seconds
  - suggestion context chunk count
  - chat context chunk count
  - include chat in suggestions
  - live suggestion prompt
  - detailed answer prompt
  - chat prompt
- add save and close actions
- add validation for empty or obviously malformed input where useful
- surface whether settings are saved only for the session or reused
- ensure no key is ever printed to console logs
- verify that the app blocks AI requests when no API key is present

### Phase 5: Microphone Capture - Completed

- create `lib/audio-recorder.ts`
- implement `createChunkRecorder`
- request mic permissions with `navigator.mediaDevices.getUserMedia`
- instantiate `MediaRecorder`
- prefer `audio/webm;codecs=opus`
- add fallback handling if the preferred mime type is unsupported
- create logic for:
  - start recording
  - stop recording
  - auto-stop after 30 seconds
  - manual flush of current chunk
- capture chunk start and end timestamps
- return a `Blob` suitable for upload
- stop duplicate recorder starts
- handle recorder cleanup on stop/unmount
- add unsupported-browser error messaging
- verify the recorder can:
  - start
  - auto-complete a chunk
  - flush a partial chunk
  - stop cleanly

### Phase 6: Transcription API Route - Completed

- create `lib/groq.ts`
- create a helper to instantiate the Groq client with a user-supplied key
- create `app/api/transcribe/route.ts`
- parse multipart form data
- validate:
  - `apiKey`
  - `file`
  - `language`
  - timing metadata
- send the uploaded audio to Groq `whisper-large-v3`
- request `verbose_json`
- request segment timestamps
- normalize the Groq response into the app’s `TranscriptChunk` shape
- return a stable JSON payload to the client
- handle:
  - missing key
  - missing file
  - Groq 4xx responses
  - Groq 5xx responses
- verify the route works with a real audio file upload

### Phase 7: Transcript Flow - Completed

- create a client helper to upload blobs to `/api/transcribe`
- wire the recorder `onChunk` callback to:
  - set `isTranscribing`
  - upload the chunk
  - append transcript
  - clear `isTranscribing`
- append transcript chunks in order
- render transcript timestamps
- auto-scroll transcript on every new chunk
- add empty state UI for no transcript yet
- add inline status states:
  - idle
  - recording
  - transcribing
- verify transcript chunks appear correctly after each completed chunk
- verify no duplicate transcript entries are appended

### Phase 8: Suggestion Context Builder - Completed

- create `lib/context.ts`
- implement a helper to select the recent transcript window
- implement a helper to serialize transcript chunks into prompt text
- implement a helper to serialize recent suggestion batches
- decide whether recent chat should be included in suggestion context by default
- cap transcript context to a bounded number of chunks
- include last 1 to 2 suggestion batches for anti-repetition
- keep the context format stable for prompt caching
- verify the produced prompt context is readable and compact

### Phase 9: Suggestion Prompt Defaults - Completed

- create `lib/prompts.ts`
- add a default live suggestion prompt
- add a default detailed answer prompt
- add a default chat prompt
- ensure the live suggestion prompt explicitly instructs:
  - exactly 3 suggestions
  - immediate usefulness
  - diversity when supported
  - no generic filler
  - careful fact-check usage
- ensure the detailed answer prompt expands a clicked suggestion rather than repeating it
- ensure the chat prompt supports free-form user questions grounded in transcript context
- verify prompts are editable from settings without code changes

### Phase 10: Suggestion API Route - Completed

- create `app/api/suggestions/route.ts`
- validate request payload
- send request to Groq `openai/gpt-oss-120b`
- use strict structured output with JSON schema
- ensure the schema requires:
  - batch id
  - batch timestamp
  - based-on chunk ids
  - exactly 3 suggestions
  - suggestion type enum
  - preview text
  - detailed prompt seed
  - rationale
  - confidence
- parse model output JSON
- validate the result with Zod
- normalize generated ids/timestamps if absent
- return the validated batch to the client
- handle:
  - invalid schema output
  - Groq failure
  - missing key
  - empty transcript context
- verify the route consistently returns exactly 3 suggestions

### Phase 11: Suggestion Generation Flow - Completed

- create a client helper for `/api/suggestions`
- wire suggestion generation after every successful transcript append
- serialize the bounded transcript context
- pass recent suggestion history to reduce repetition
- set `isGeneratingSuggestions` before request
- clear `isGeneratingSuggestions` after request
- prepend the new suggestion batch to the suggestion list
- keep older batches below the newest one
- style only the newest batch as fresh
- preserve old suggestions if a new request fails
- verify suggestions update automatically after a transcript chunk

### Phase 12: Suggestion UI - Completed

- finish `components/suggestions-panel.tsx`
- render suggestion batches newest-first
- render each suggestion as a clickable card
- map internal suggestion types to user-friendly labels
- visually distinguish:
  - fresh suggestions
  - stale older suggestions
- add empty state for no suggestions yet
- add loading state while suggestions are being generated
- add refresh button UI
- add countdown or status text for auto-refresh behavior if desired
- verify the preview text is readable and useful on its own

### Phase 13: Chat API Route - Completed

- create `app/api/chat/route.ts`
- validate request payload
- build transcript context using the configured chat context window
- include rolling summary if available
- include prior chat history in the request
- use Groq `openai/gpt-oss-120b`
- enable streaming
- convert the Groq stream into a `ReadableStream`
- return a stream response that the browser can consume incrementally
- handle missing key or bad input
- handle interrupted streams gracefully
- verify first-token latency feels fast enough

### Phase 14: Chat Client Flow - Completed

- create a client stream helper for `/api/chat`
- in the store, support:
  - appending a user message
  - inserting an empty assistant placeholder
  - incrementally appending streamed tokens
- create a reusable handler for sending typed chat questions
- wire the chat input send button
- wire Enter key submission
- disable duplicate sends while a stream is active if necessary
- render chat messages in order
- auto-scroll chat on message append and stream updates
- add empty chat state UI
- verify typed questions work before wiring suggestion clicks

### Phase 15: Suggestion Click Flow - Completed

- create a `useSuggestionClick` helper or equivalent action
- on click:
  - append the suggestion preview as a user message
  - append assistant placeholder
  - send a detailed-answer request to `/api/chat`
- include in the request:
  - suggestion type
  - suggestion preview
  - suggestion `detailedPromptSeed`
  - transcript context
  - rolling summary
  - prior chat history
- stream the assistant answer into the placeholder
- clear `isChatStreaming` when done
- verify click-through answers are meaningfully richer than previews

### Phase 16: Manual Refresh - Completed

- add a refresh button to the suggestions panel
- create `handleRefresh`
- if recording is active:
  - flush the current recorder chunk
  - transcribe the partial chunk as `manual-flush`
  - append transcript
  - generate suggestions
  - restart the recorder
- if recording is inactive:
  - generate suggestions from current transcript state
- prevent concurrent refresh while already transcribing or generating
- verify manual refresh updates transcript first, then suggestions
- verify refresh does not duplicate or lose chunks

### Phase 17: Recording Loop Control - Completed

- create the high-level start-recording action
- create the high-level stop-recording action
- on start:
  - set recording state
  - start recorder
- on auto chunk completion:
  - transcribe
  - append transcript
  - generate suggestions
  - start next chunk if still recording
- on stop:
  - stop current recorder
  - decide whether to flush or discard partial chunk
- ensure loop restarts only when intended
- verify no overlapping recorder instances exist

### Phase 18: Export - Completed

- create `lib/export-session.ts`
- build a normalized export payload
- include:
  - session metadata
  - transcript chunks
  - suggestion batches
  - chat messages
  - rolling summary
  - non-secret settings snapshot
- explicitly exclude the raw Groq API key from export unless intentionally desired
- add JSON download helper
- add export button to the UI
- verify the downloaded JSON is valid and complete

### Phase 19: Error Handling - Completed

- define a consistent strategy for surfacing errors in the UI
- add reusable API error parsing helper
- handle:
  - missing API key
  - unsupported browser
  - denied mic permission
  - empty audio chunk
  - transcription failure
  - suggestion failure
  - chat stream failure
  - 429 rate limits
  - malformed structured output
- ensure existing transcript and old suggestion batches remain visible after failures
- add retry affordances where helpful
- verify no silent failures remain in the main loop

### Phase 20: Styling and Polish - Completed

- port the necessary visual styles from `mockup.html`
- style the top bar
- style the panel shells
- style transcript lines and timestamps
- style mic button idle and recording states
- style suggestion type tags
- style fresh vs stale suggestion cards
- style chat bubbles for user vs assistant
- style loading and empty states
- verify layout works on laptop-sized screens
- verify layout remains usable on smaller screens

### Phase 21: Prompt Tuning - Completed

- test live suggestions against multiple meeting scenarios
- evaluate:
  - usefulness
  - specificity
  - diversity
  - repetition
  - click-through answer quality
- refine default suggestion prompt
- refine default detailed-answer prompt
- refine default chat prompt
- tune context chunk counts for speed vs quality
- adjust temperature if outputs are too repetitive or too unstable
- verify fact-check suggestions are not overused

### Phase 22: Optional Rolling Summary - Completed

- decide whether summary memory is worth adding
- if yes, create summary update logic every 1 to 2 chunks
- keep summary short and bounded
- include:
  - topic
  - decisions
  - open questions
  - unresolved risks
- store summary in session state
- feed it into suggestions and chat
- verify it improves continuity without noticeable latency regression

### Phase 23: Final QA - Completed

- test recording start and stop
- test automatic chunk transcription
- test automatic suggestion generation
- test refresh while recording
- test refresh while idle
- test suggestion click-to-chat
- test typed chat
- test export
- test settings persistence behavior
- test missing-key behavior
- test network error behavior
- inspect console for unhandled errors
- inspect exported session JSON manually

### Phase 24: Submission Readiness - Completed

- ensure the app works end-to-end with a pasted Groq key
- confirm no keys are hard-coded anywhere
- confirm no secrets are printed in logs
- write or update README with:
  - setup
  - stack choices
  - prompt strategy
  - tradeoffs
- deploy to a public URL
- smoke-test the deployed app in the browser
- verify the deployed app still supports:
  - recording
  - suggestions
  - chat
  - export
- do one final live dry run using the app as if in the interview
