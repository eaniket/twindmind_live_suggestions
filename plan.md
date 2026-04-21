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

### Update 4 - Completed

- [x] generate suggestions only from transcript text that has already been transcribed and is visible in the UI
- [x] remove manual recorder flush from reload behavior while recording
- [x] keep transcription on a fixed 30-second cadence while recording
- [x] keep the suggestion countdown aligned to that same cadence
- [x] ensure manual reload does not reset the auto-refresh timer
- [x] render only the newest transcript block at full emphasis and fade older transcript blocks

### Update 5 - Completed

- [x] remove the `Chat history in suggestions` control from Settings
- [x] always include recent chat turns in suggestion context by default

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

### Chat First-Token Latency Optimization - Completed

Goal: reduce `chat send -> first token` latency by cutting prompt payload size, minimizing client-side pre-stream work, and improving perceived responsiveness in the UI.

- [x] put the user message into the `streamChatResponse(...)` call immediately after creating the assistant placeholder
- [x] avoid unnecessary preprocessing before `streamChatResponse(...)`
- [x] keep the assistant bubble mounted before the first streamed token arrives
- [x] show a lightweight `Thinking...` placeholder immediately while waiting for the first token
- [x] shrink chat context aggressively for latency-sensitive chat requests
- [x] reduce `chatContextChunkCount` when optimizing for first-token speed
- [x] reduce chat history length sent into `/api/chat`
- [x] reduce metadata verbosity to the highest-signal compact fields only
- [x] keep `DEFAULT_CHAT_PROMPT` short, directive, and low-bloat
- [x] verify first-token latency improvements compile cleanly with `npm run typecheck`
- [x] implement chat-specific context narrowing:
  - transcript window capped to 4 chunks
  - chat history sent to `/api/chat` capped to 4 messages
  - suggestion-click seed history capped to 2 messages
  - chat metadata reduced to SUMMARY, MODE, NEED, TONE, and RISKS when present

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
  - flush the in-progress recorder chunk
  - transcribe the partial chunk as `manual-flush`
  - append the new transcript before generating suggestions
  - do not restart or reset the timer
- if recording is inactive:
  - generate suggestions from current transcript state
- prevent concurrent refresh while already transcribing or generating
- verify manual refresh updates transcript state before suggestions
- verify refresh does not duplicate or lose chunks

### Reload Suggestion Latency Optimization - Completed

Goal: reduce `Reload suggestions` latency after the transcript update step by shrinking the prompt payload used for suggestion generation.

- [x] keep suggestion context smaller during manual reload
- [x] reduce `suggestionContextChunkCount` when optimizing for reload speed
- [x] reduce the amount of recent suggestion history sent into the suggestion request
- [x] reduce the recent transcript window used for reload-generated suggestions
- [x] cap recent suggestion history to the last 1 to 2 suggestion batches
- [x] prefer the highest-signal compact context over broader continuity when reload speed is the priority
- [x] verify suggestion quality remains acceptable after shrinking reload context via `npm run typecheck`
- [x] implement reload-specific context narrowing:
  - transcript limit capped to 2 chunks for manual reload suggestion generation
  - recent suggestion history capped to the latest 1 batch for manual reload suggestion generation

### Phase 17: Recording Loop Control - Completed

- create the high-level start-recording action
- create the high-level stop-recording action
- on start:
  - set recording state
  - start recorder
- on auto chunk completion:
  - immediately start the next 30-second recording window if still recording
  - transcribe
  - append transcript
  - generate suggestions
- keep the visible suggestion countdown aligned to the current 30-second recording window
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

### Phase 26: Background Context Metadata Service - Completed

Goal: add a lightweight background service that runs after every 2 committed transcript cycles and maintains a higher-level view of the current conversation. This metadata should improve suggestion timing and type selection without blocking the visible transcription or suggestion loop, and it should be persisted in the backend so other routes and prompts can read it directly.

Implementation choice: use a server-side in-memory session store keyed by `sessionId`, a background metadata refresh queue per session, a `POST /api/context-metadata/refresh` enqueue route, and direct metadata reads inside `/api/suggestions` and `/api/chat`. The background metadata refresh also generates an LLM-written summary from the last 6 transcript chunks.

#### The 5 metadata points that matter most

1. `conversationMode`
   Why it matters: this is the strongest driver of which suggestion type should appear next.
   Example values: `discovery`, `brainstorming`, `status_update`, `problem_solving`, `planning`, `decision_making`, `wrap_up`.

2. `toneAndPressure`
   Why it matters: suggestions should sound different in a calm collaborative discussion versus a tense, skeptical, or urgent exchange.
   Example values: `collaborative`, `neutral`, `skeptical`, `tense`, `urgent`.

3. `userResponseNeed`
   Why it matters: live suggestions are best when they match whether the user needs to ask, answer, clarify, defend, or close.
   Example values: `ask_now`, `answer_now`, `reframe_now`, `decide_now`, `close_now`, `listen_only`.

4. `expandedSuggestionAffinity`
   Why it matters: this captures which suggestion type is actually being expanded by the user, which is the clearest behavioral signal of value.
   Example shape: `{ dominantType: "question_to_ask", counts: { question_to_ask: 4, talking_point: 1 } }`

5. `riskSignals`
   Why it matters: this is the main guardrail for deciding when to surface `fact_check`, `next_step`, or sharper clarification prompts.
   Example flags: `factual_uncertainty`, `misalignment`, `decision_ambiguity`, `ownership_gap`, `timeline_risk`.

Do not add more top-level metadata than this. More fields will dilute reliability and create prompt noise faster than they add value.

#### Implemented lifecycle

- Keep this service fully off the critical path. Transcription and visible suggestion generation stay on the critical path.
- After each committed transcript chunk, increment a local counter.
- When the counter reaches 2, reset it and enqueue a background metadata refresh request. Do not `await` it from the transcribe flow.
- The refresh should use the latest committed transcript, rolling summary, recent suggestion batches, and suggestion click history.
- If a metadata refresh is already in flight for the same session, do not start another. Mark the session as `queued` or `stale` and let the current refresh finish first.
- Suggestions should always use the latest completed metadata snapshot from backend storage, never wait for a new refresh to finish.
- If the metadata service is slow or fails, main services should continue exactly as they do today.

#### Concurrency rule

The metadata service must never delay the main loop.

- Best case: run in parallel with the next recording/transcribe cycle.
- Minimum acceptable behavior: start only after the current transcript commit and suggestion request have already been dispatched.
- Not acceptable: any design where transcription, visible suggestion generation, or chat waits for metadata generation.

The cleanest model is a fire-and-forget enqueue from the client and backend-owned processing:

```ts
if (transcriptChunk.text.trim()) {
  commitTranscriptChunk(transcriptChunk);
  void enqueueContextMetadataRefresh();
  await generateSuggestions();
}
```

This works because `generateSuggestions()` reads the last completed metadata snapshot, not the one being computed right now.

#### Backend ownership

Do not treat this as only client state. The backend should own the durable metadata record for the session so all services can read the same snapshot.

- The client should send a background refresh signal with `sessionId` and the latest `basedOnChunkIds`.
- The backend should compute and persist the metadata snapshot.
- `/api/suggestions` should read the latest stored metadata for that session.
- `/api/chat` can also read it later if needed for better answer framing.
- The client may optionally mirror the latest snapshot in Zustand for debugging or UI, but the backend copy is the source of truth.

#### Proposed state shape

```ts
export type ContextMetadata = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  status: "ready" | "refreshing" | "stale" | "failed";
  basedOnChunkIds: string[];
  llmSummary: string;
  conversationMode:
    | "discovery"
    | "brainstorming"
    | "status_update"
    | "problem_solving"
    | "planning"
    | "decision_making"
    | "wrap_up";
  toneAndPressure:
    | "collaborative"
    | "neutral"
    | "skeptical"
    | "tense"
    | "urgent";
  userResponseNeed:
    | "ask_now"
    | "answer_now"
    | "reframe_now"
    | "decide_now"
    | "close_now"
    | "listen_only";
  expandedSuggestionAffinity: {
    dominantType: string | null;
    countsByType: Record<string, number>;
  };
  riskSignals: Array<
    | "factual_uncertainty"
    | "misalignment"
    | "decision_ambiguity"
    | "ownership_gap"
    | "timeline_risk"
  >;
};
```

Suggested backend table or document shape:

```ts
type StoredContextMetadata = ContextMetadata & {
  version: number;
  error?: string;
};
```

Storage can be a DB table, Redis JSON record, or any session-scoped document store. The main requirement is fast read access by `sessionId`.

#### Suggested trigger point in the controller

This should happen immediately after `commitTranscriptChunk(...)`, because that is the point where transcript state and rolling summary are stable.

```ts
const metadataCycleRef = useRef(0);

const enqueueContextMetadataRefresh = async () => {
  metadataCycleRef.current += 1;
  if (metadataCycleRef.current < 2) {
    return;
  }

  metadataCycleRef.current = 0;
  const state = useSessionStore.getState();
  void fetch("/api/context-metadata/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: state.startedAt,
      basedOnChunkIds: state.transcriptChunks.slice(-6).map((chunk) => chunk.id),
    }),
  });
};
```

Then wire it beside the existing transcript commit path:

```ts
if (transcriptChunk.text.trim()) {
  commitTranscriptChunk(transcriptChunk);
  void enqueueContextMetadataRefresh();
  await generateSuggestions();
}
```

#### Suggested backend API shape

`POST /api/context-metadata/refresh`

- Input: `sessionId`, latest `basedOnChunkIds`
- Behavior:
  - verify whether a refresh is already running for that session
  - if yes, mark session metadata as `stale` and return immediately
  - if no, start background computation and return immediately with `202 Accepted`
- Output: queue acknowledgement only, not the computed metadata

`GET /api/context-metadata`

- Input: `sessionId`
- Output: latest persisted metadata snapshot for that session

#### Suggested metadata inputs

```ts
function buildMetadataSnapshot(state: SessionState) {
  return {
    sessionId: state.startedAt,
    rollingSummary: state.rollingSummary,
    transcriptText: formatTranscriptChunks(state.transcriptChunks.slice(-6)),
    recentSuggestions: state.suggestionBatches.slice(0, 3),
    expandedSuggestionTypes: state.chatMessages
      .filter((message) => message.source === "suggestion_click")
      .slice(-10),
  };
}
```

Backend-side, the refresh worker should read the canonical session context from storage rather than trusting only the client payload.

#### How suggestions should use this metadata

Do not dump raw JSON into the prompt if it can be avoided. Serialize it into a compact guidance block that the suggestion prompt can consume reliably.

```ts
function formatContextMetadata(metadata: ContextMetadata | null) {
  if (!metadata) {
    return "None";
  }

  return [
    `CONVERSATION_MODE: ${metadata.conversationMode}`,
    `TONE_AND_PRESSURE: ${metadata.toneAndPressure}`,
    `USER_RESPONSE_NEED: ${metadata.userResponseNeed}`,
    `DOMINANT_EXPANDED_TYPE: ${metadata.expandedSuggestionAffinity.dominantType ?? "none"}`,
    `RISK_SIGNALS: ${metadata.riskSignals.join(", ") || "none"}`,
  ].join("\\n");
}
```

Then pass it into the suggestion request alongside transcript and rolling summary:

```ts
const content = [
  `ROLLING_SUMMARY:\n${input.rollingSummary || "None"}`,
  `CONTEXT_METADATA:\n${input.contextMetadata || "None"}`,
  `RECENT_TRANSCRIPT:\n${input.transcriptText}`,
  `RECENT_SUGGESTION_BATCHES:\n${input.recentSuggestions || "None"}`,
  "Return exactly 3 suggestions.",
].join("\n\n");
```

`/api/suggestions` should load this metadata before calling the model:

```ts
const contextMetadata = await getStoredContextMetadata(input.sessionId);

const content = [
  `ROLLING_SUMMARY:\n${input.rollingSummary || "None"}`,
  `CONTEXT_METADATA:\n${formatContextMetadata(contextMetadata)}`,
  `RECENT_TRANSCRIPT:\n${input.transcriptText}`,
  `RECENT_SUGGESTION_BATCHES:\n${input.recentSuggestions || "None"}`,
  "Return exactly 3 suggestions.",
].join("\n\n");
```

#### Design notes

- This service should influence suggestion selection, not replace transcript grounding.
- `expandedSuggestionAffinity` should be treated as a soft preference, not a hard routing rule, otherwise the system will overfit to one suggestion type.
- `riskSignals` should be sparse. If everything is always marked risky, `fact_check` quality will collapse.
- If metadata generation fails, keep using the last successful metadata snapshot from backend storage and continue normal suggestions.
- If latency becomes noticeable, first reduce metadata refresh frequency before shrinking transcript context.
- If backend queueing is unavailable, fall back to a best-effort async route handler that returns immediately and updates storage after response dispatch. Still do not block the main loop.

#### Completed todo list

- [x] Define the data contract
- add `ContextMetadata` and `StoredContextMetadata` types in shared types
- define enums or string unions for `conversationMode`, `toneAndPressure`, `userResponseNeed`, and `riskSignals`
- define a request type for `POST /api/context-metadata/refresh`
- define a response type for `GET /api/context-metadata`
- decide whether `expandedSuggestionAffinity.countsByType` remains a free-form map or is narrowed to known suggestion tags

- [x] Decide the backend storage model
- choose the storage layer for session metadata: database table, Redis record, or session-scoped document store
- define the storage key as `sessionId`
- decide retention and cleanup policy for old metadata records
- decide whether metadata records need optimistic versioning
- decide whether transcript context also needs backend persistence now or whether metadata generation can work from current request payloads in the first iteration

- [x] Design the session persistence dependency
- define how backend services will retrieve canonical session context for a given `sessionId`
- decide whether transcript chunks, suggestion batches, and suggestion-click history must be persisted server-side for this phase
- if yes, list the minimum session artifacts to store in backend-readable form
- if no, document the temporary limitation that metadata quality depends on client-provided snapshots
- define how `/api/suggestions` and `/api/chat` will resolve `sessionId`

- [x] Add validation schemas
- add Zod schema for stored metadata
- add Zod schema for metadata refresh requests
- add Zod schema for metadata refresh worker output
- add parser/validator for storage reads so corrupt metadata does not break suggestions

- [x] Create backend metadata storage helpers
- add a helper to read metadata by `sessionId`
- add a helper to upsert metadata by `sessionId`
- add a helper to update metadata `status` without overwriting the last successful snapshot
- add a helper to mark a snapshot `stale`, `refreshing`, `ready`, or `failed`
- decide whether to store `error` and `version` on every write

- [x] Design the background refresh route
- create the contract for `POST /api/context-metadata/refresh`
- make the route return immediately with queue acknowledgement semantics
- define how the route detects an in-flight refresh for the same session
- define what happens when a refresh is already running: ignore, mark stale, or collapse duplicate work
- define how the route records refresh timestamps for observability

- [x] Design the metadata read route
- create the contract for `GET /api/context-metadata`
- define its behavior when no snapshot exists yet
- decide whether it returns `404`, `204`, or an explicit empty payload
- ensure the route can be consumed by suggestions, chat, and future UI debug surfaces

- [x] Design the metadata generation step
- define the exact model input used to derive metadata
- decide whether to use the current LLM provider or a cheaper/faster route for metadata generation
- define the structured output shape returned by the model
- define fallback behavior if the model returns partial or invalid structured output
- ensure the metadata prompt is short and stable so it does not create prompt bloat

- [x] Define the metadata prompt
- write a dedicated metadata-generation system prompt
- instruct it to output exactly the 5 approved metadata points and nothing extra
- instruct it to prefer stable classifications over overfitted nuance
- instruct it to use `expandedSuggestionAffinity` as observed behavior, not speculation
- instruct it to keep `riskSignals` sparse and evidence-based
- [x] Add an LLM-generated recent-context summary to the metadata snapshot
- generate it from the last 6 transcript chunks in the same background refresh job
- persist it with the rest of the context metadata so suggestions and chat can read it

- [x] Add controller-side orchestration
- add a local cycle counter for committed transcript chunks
- increment it only after a successful committed transcript append
- enqueue the background refresh after every second committed chunk
- ensure the enqueue call is fire-and-forget and not awaited
- ensure manual refresh and stop-recording paths do not accidentally enqueue overlapping metadata work too aggressively

- [x] Protect the main loop from contention
- verify that transcription completion does not wait for metadata enqueue acknowledgement
- verify that suggestion generation continues even if metadata enqueue fails
- verify that chat requests do not wait for metadata refresh completion
- define a timeout budget for metadata refresh work that is separate from transcribe and suggestion time budgets
- define a concurrency cap of one in-flight refresh per session

- [x] Feed metadata into suggestions
- add `sessionId` to the suggestion request contract if it is not already there
- load the latest stored metadata inside `/api/suggestions`
- format metadata into a compact prompt block
- ensure suggestions use the last completed metadata snapshot, not an in-progress one
- define behavior when metadata is missing, stale, or failed

- [x] Decide whether chat should consume metadata in this phase
- decide whether `/api/chat` should read context metadata now or later
- if now, define the exact metadata fields that improve answer framing
- if later, document that the read path is intentionally suggestions-only in Phase 26

- [x] Track suggestion expansion behavior
- define how clicked suggestions map into `expandedSuggestionAffinity`
- decide whether this is computed live in memory, persisted per session, or derived from stored chat history
- decide how many recent suggestion clicks to consider
- define how to handle renamed or newly added suggestion types over time
- ensure a missing click history does not degrade metadata generation

- [x] Handle failure and stale-state behavior
- preserve the last successful snapshot if a refresh fails
- mark metadata `failed` without clearing previously good fields
- mark metadata `stale` when new transcript chunks arrive during an in-flight refresh
- decide when a stale snapshot is still acceptable for prompts
- define retry behavior for transient backend or model failures

- [x] Add observability
- log refresh enqueue events with `sessionId` and chunk ids
- log refresh start and finish timestamps
- log when duplicate refreshes are collapsed
- log metadata validation failures separately from provider failures
- add lightweight counters for refresh success rate and average latency

- [x] Add testing tasks
- test that metadata enqueue starts only after every second committed transcript chunk
- test that transcription latency is unaffected when metadata refresh is enabled
- test that suggestion generation continues while metadata refresh is in flight
- test that `/api/suggestions` reads the latest successful snapshot
- test that an invalid metadata model response does not break the session
- test that duplicate refresh requests for the same session do not overlap
- test that a failed refresh preserves the prior ready snapshot

- [x] Add manual QA tasks
- run a multi-chunk session and confirm metadata updates in the background without visible delay
- confirm suggestions keep rendering on normal cadence while metadata refreshes happen
- confirm a hard metadata failure does not stop transcript or suggestion updates
- confirm metadata changes actually influence suggestion type selection in later cycles
- inspect stored records and confirm `status`, `basedOnChunkIds`, and timestamps update correctly

- [x] Document rollout constraints
- document that Phase 26 should not change visible UX until quality is confirmed
- document storage requirements for deployment environments
- document the temporary backend session assumptions if full session persistence is not yet in place
- document how to disable metadata refresh quickly if it causes instability
- document the follow-up phase for using the same metadata in chat and analytics

### Phase 25: Flash Reload Purge - Completed

- [x] remove the `Flash reload` toggle from the settings dialog UI
- [x] remove the lightning icon mode from the reload suggestions button
- [x] remove any button copy, status text, or UI behavior that implies hidden prefetching
- [x] remove `flashReload` from `SessionSettings`
- [x] remove `flashReloadBatch` from session state
- [x] remove `flashReloadSignature` from session state
- [x] remove `isFlashReloadPrefetching` from session state
- [x] remove store actions used only for flash reload state management
- [x] remove flash reload defaults and normalization from the settings store
- [x] remove flash reload persistence from `sessionStorage`
- [x] remove flash reload references from the export payload
- [x] remove flash reload refs from `lib/session-controller.tsx`
- [x] remove flash reload invalidation logic from `lib/session-controller.tsx`
- [x] remove hidden prefetch request logic from `lib/session-controller.tsx`
- [x] remove auto-advance flash reload logic from `lib/session-controller.tsx`
- [x] simplify visible suggestion rendering to a single path
- [x] simplify `refreshSuggestions()` so it always uses the normal visible generation path
- [x] simplify reload busy-state logic so it depends only on visible work
- [x] remove all `Future flash reload extension` notes from the plan
- [x] remove flash reload references from `README.md`
- [x] remove flash reload references from `research.md`
- [x] search the repo for `flashReload`, `Flash reload`, and `flash reload` and clear all remaining code references
- [x] run `npm run typecheck`
- [x] manually verify:
  - [x] the settings dialog has no flash reload option
  - [x] the reload button has only one normal mode
  - [x] stopping the mic stops all countdown-driven suggestion activity
  - [x] reload flushes/transcribes the in-progress chunk first, then generates a fresh suggestion batch
  - [x] no hidden prefetch state remains anywhere in the UI or runtime flow

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
