# TwinMind Live Suggestions Research

## Purpose

This document translates `PRD.md` into a build blueprint. It is not just a restatement of requirements. It covers:

- what the assignment is really testing
- the hidden implementation constraints implied by the PRD and mockup
- a recommended architecture
- prompt and context strategy
- concrete API and data shapes
- latency, rate-limit, and security considerations
- a pragmatic build order that is strong enough for the assignment without over-engineering

## What This Assignment Is Actually Evaluating

The PRD looks like a simple three-column app, but the real test is whether the app can surface useful, well-timed, context-sensitive suggestions during a live conversation.

The highest-value work is not the UI. It is:

- deciding what transcript context to send and when
- producing exactly 3 suggestions that are meaningfully different
- making the suggestions useful even before click-through
- turning a clicked suggestion into a better, more detailed answer
- keeping latency low enough that the app feels live

In practice, the evaluator is likely to judge:

- whether suggestions feel "right now" rather than generic
- whether the three suggestions are diverse
- whether the card text is actionable and specific
- whether the detailed answer is materially better than the preview
- whether the refresh cycle feels dependable
- whether the code is clean and defendable

## Non-Negotiable Product Requirements

From the PRD and mockup, the app must include:

- a 3-column layout: transcript, live suggestions, chat
- mic start/stop
- transcript appended in chunks roughly every 30 seconds
- transcript auto-scroll
- suggestions refreshed automatically every roughly 30 seconds
- a manual refresh button that updates transcript first, then suggestions
- exactly 3 new suggestions per refresh
- newest suggestion batch at the top, old batches retained below
- suggestion cards that provide standalone value before click
- click on suggestion adds it to chat and gets a longer detailed answer
- free-form chat input
- one session-only chat with no login and no persistence requirement
- export of transcript, suggestion batches, and chat with timestamps
- settings screen for Groq API key, prompts, and context parameters
- Groq only:
  - `whisper-large-v3` for transcription
  - `openai/gpt-oss-120b` for suggestions and chat

## Hidden Constraints Implied By The PRD

These are the details that are easy to miss and matter a lot:

### 1. Manual refresh is not just "regenerate suggestions"

The PRD says refresh should "update transcript then suggestions". That means if the user taps refresh while a 30-second audio chunk is still being recorded, the app should:

1. stop and flush the current partial audio chunk
2. send it for transcription
3. append the resulting transcript chunk
4. immediately generate the next suggestion batch from the updated transcript
5. restart recording if the mic was already on

If refresh only reruns the suggestion prompt against stale transcript, it misses the requirement.

### 2. Thirty-second chunking is not arbitrary

Whisper Large v3 is optimized for 30-second audio segments. That makes the PRD's chunk timing unusually aligned with the model. This is a strong hint that the correct implementation is browser audio chunking plus server-side transcription on each chunk, not browser speech APIs.

### 3. "Exactly 3 suggestions" means you want structured output

Free-form prompting is risky because the model may return the wrong count or inconsistent formatting. The cleanest approach is to use a strict JSON schema for the live suggestion response and render from validated typed data.

### 4. Chat and suggestions have different latency needs

Suggestions should be short, structured, and deterministic.

Chat should be streamed. The evaluator will notice whether clicking a suggestion produces an immediate first token or a frozen UI.

### 5. The Groq API key requirement creates a security design choice

The user pastes their own API key, but the key should not be embedded in frontend code or shipped in the bundle. The clean pattern is:

- user enters the key in settings
- frontend stores it only for the session or in local storage if explicitly chosen
- frontend sends it to your backend routes over HTTPS
- backend uses that key to call Groq
- backend never logs it and never persists it

For this assignment, session-scoped storage is the simplest reasonable default.

### 6. The assignment is single-session, but context still matters

No long-term persistence is required, but one active session still needs a memory strategy. If you only send the latest chunk, suggestions become shallow. If you send the entire transcript forever, latency and token cost worsen. The design needs a bounded rolling context.

## Recommended Stack

The best tradeoff for this assignment is:

- Next.js 15 with App Router
- React + TypeScript
- Route Handlers for server API endpoints
- CSS modules or Tailwind for layout polish
- Zod for request and response validation
- `MediaRecorder` for browser audio capture
- `groq-sdk` or OpenAI-compatible `openai` client pointed at Groq
- Server-Sent Events or streamed fetch response for chat streaming
- local component state or Zustand for client session state

Why this stack:

- Next.js makes it easy to deploy to Vercel
- frontend and backend live in one repo
- route handlers are enough for proxying Groq requests
- TypeScript + Zod reduce bugs in the structured suggestion flow
- no database is needed

## Current Groq Constraints That Should Shape The Build

These details are worth designing around up front:

- `openai/gpt-oss-120b` currently supports a `131,072` token context window and up to `65,536` output tokens, but you should not treat that as a reason to send the full transcript every time
- `openai/gpt-oss-120b` supports strict structured outputs, which is ideal for the live suggestion cards
- structured outputs do not currently support streaming, so use them for suggestions, not chat
- prompt caching is available on `openai/gpt-oss-120b` and works automatically when the request prefix stays stable
- prompt cache entries are volatile and expire after about 2 hours without reuse, so stable prompt prefixes help repeated suggestion and chat calls
- `whisper-large-v3` is built for 30-second speech segments, supports common browser-uploaded audio formats, and allows up to `100 MB` files on the developer tier
- Groq's speech-to-text endpoints support `verbose_json` plus segment and word timestamp granularities

Relevant developer-plan limits are also worth keeping in mind for prompt sizing:

- `openai/gpt-oss-120b`: `30 RPM`, `8K TPM`, `1K RPD`, `200K TPD`
- `whisper-large-v3`: `20 RPM`, `2K RPD`, `7.2K ASH`, `28.8K ASD`

For one evaluator using one browser tab, these limits are workable. The bigger risk is not hitting RPM. It is wasting TPM with oversized transcript context and slowing the app down.

## Recommended High-Level Architecture

```text
Browser
  -> MediaRecorder captures audio/webm chunks
  -> POST /api/transcribe with current chunk
  -> transcript state updated in client
  -> POST /api/suggestions with recent transcript context
  -> render new 3-card batch at top
  -> click suggestion or typed chat
  -> POST /api/chat and stream response

Server
  -> validates payloads
  -> uses user-supplied Groq API key per request
  -> calls Groq Whisper for transcription
  -> calls Groq GPT-OSS 120B for suggestions
  -> calls Groq GPT-OSS 120B for detailed chat answers
  -> never persists session data
```

## Core Product Flows

### 1. Start Recording

When the user clicks the mic:

- request microphone permission
- start a `MediaRecorder` session
- record a chunk for 30 seconds
- on chunk completion:
  - send audio to transcription API
  - append transcript chunk
  - trigger suggestion generation
  - restart the next chunk automatically if still recording

Recommended behavior:

- show clear states: idle, recording, transcribing, generating suggestions
- disable duplicate refresh actions while a transcription flush is already in progress

### 2. Automatic Suggestion Refresh

After each transcript chunk is appended:

- build context from recent transcript plus rolling session memory
- request exactly 3 suggestions
- render them as a new top batch
- mark older cards visually stale but still clickable

Important:

- the transcript and suggestion cycle should be coupled
- avoid running suggestions before the latest transcription is available

### 3. Manual Refresh

If recording is active:

- stop current recorder
- flush partial audio
- transcribe partial chunk
- update transcript
- generate suggestions
- resume recording with a fresh chunk

If recording is inactive:

- just run suggestions against the current transcript

### 4. Click Suggestion

When a suggestion card is clicked:

- add the suggestion preview to chat as a user message
- send a richer prompt with more transcript context plus the selected suggestion metadata
- stream back the detailed answer

This needs a different prompt than the live suggestion generator. The click-through answer should feel like an expansion, not a repetition.

### 5. Free-Form Chat

When the user types a question:

- append the user message
- stream the assistant reply
- preserve the entire in-session chat history for future turns

### 6. Export

The export should serialize:

- session metadata
- transcript chunks with timestamps
- all suggestion batches with timestamps
- all chat messages with timestamps
- settings snapshot used during the session

JSON is better than plain text for grading because it is auditable.

## Audio Capture and Transcription Design

### Recommended Browser Strategy

Use `MediaRecorder` with `audio/webm;codecs=opus` if supported. This is widely practical in modern Chromium browsers and small enough for periodic upload.

Flow:

1. open `getUserMedia({ audio: true })`
2. create `MediaRecorder`
3. record until 30 seconds elapse
4. call `stop()`
5. assemble blob
6. upload blob to backend
7. backend forwards file to Groq transcription endpoint
8. restart a new recorder session immediately

This is more reliable than trying to continuously stream raw PCM for an assignment app.

### Why Not Use Web Speech API

Do not use browser-native speech recognition as the primary transcription path because:

- the PRD explicitly requires Groq + Whisper Large V3
- browser speech APIs vary by browser and region
- results are harder to benchmark and defend

### Transcription Request Design

Recommended parameters:

- model: `whisper-large-v3`
- language: user-selectable, default `en`
- response_format: `verbose_json`
- timestamp_granularities: `["segment"]`
- temperature: `0`

Why `verbose_json`:

- useful for timestamps
- better export fidelity
- easier future debugging

Word-level timestamps are optional. Segment-level timestamps are enough for this assignment unless you want transcript highlighting.

### Transcript Chunk Shape

```ts
type TranscriptChunk = {
  id: string;
  startedAt: string;
  endedAt: string;
  createdAt: string;
  text: string;
  segments: Array<{
    startSec: number;
    endSec: number;
    text: string;
    confidenceHint?: number | null;
  }>;
  source: "auto" | "manual-flush";
};
```

Store each chunk separately. Do not flatten immediately into one large string. Chunk boundaries are useful for:

- recent-context selection
- export
- manual refresh tracing
- debugging suggestion quality

## Suggestion Engine Design

This is the most important part of the assignment.

The model needs to do two jobs well:

1. infer what is happening in the conversation right now
2. decide what would be most useful to the user at this moment

That means the prompt must encode not just transcript, but product judgment.

### Recommended Suggestion Types

Use a constrained enum:

- `question_to_ask`
- `talking_point`
- `answer`
- `fact_check`

These map directly to the PRD and mockup. Avoid making the UI taxonomy more complicated than the rubric.

### Recommendation: One Suggestion Call, Not A Pipeline Of Many Calls

Do not over-engineer this with multiple LLM stages unless you already have the rest of the app working.

For the assignment, one well-designed suggestion call per refresh is the best tradeoff:

- lower latency
- fewer failure points
- simpler debugging
- easier export and reproducibility

The key is to provide high-quality context and a strict output schema.

### Suggested Output Schema

```ts
type SuggestionBatch = {
  id: string;
  createdAt: string;
  basedOnChunkIds: string[];
  suggestions: [
    Suggestion,
    Suggestion,
    Suggestion
  ];
};

type Suggestion = {
  id: string;
  type: "question_to_ask" | "talking_point" | "answer" | "fact_check";
  preview: string;
  detailedPromptSeed: string;
  rationale: string;
  confidence: "high" | "medium" | "low";
};
```

Notes:

- `preview` is what the card shows and must be useful on its own
- `detailedPromptSeed` is hidden and used to get a better chat answer on click
- `rationale` is optional in UI but useful for export and debugging
- `confidence` helps detect weak outputs and future filtering

### Why Structured Output Matters

The live suggestion endpoint should use strict JSON schema output because it guarantees:

- exactly three suggestions
- known keys
- no markdown cleanup hacks
- strong typing on the frontend

Tradeoff:

- structured outputs do not support streaming
- that is fine for suggestions because they are short and periodic

### What Context To Send For Suggestions

Recommended prompt payload:

1. session objective and assistant role
2. a short rolling meeting memory
3. the most recent transcript window
4. optional recent chat turns
5. rules for suggestion usefulness and diversity
6. output schema

Recommended default context:

- rolling memory: 150 to 300 words
- recent transcript: last 4 transcript chunks or last 2 to 3 minutes
- recent chat: last 2 user/assistant turns if relevant

This is usually enough to understand the local moment without bloating latency.

### Rolling Meeting Memory

This is optional but high leverage.

Maintain a small session summary that captures:

- meeting topic
- participants and roles if inferred
- decisions made
- open questions
- unresolved risks
- recurring entities such as companies, products, or metrics

Two implementation options:

### Option A: No summary memory

Use only recent transcript chunks.

Pros:

- simplest
- lowest implementation cost

Cons:

- quality drops in longer meetings
- model may lose earlier commitments or context

### Option B: Small rolling summary memory

Update a bounded text summary after each transcript chunk or every other chunk.

Pros:

- much better continuity
- allows a smaller raw transcript window

Cons:

- one extra LLM call if summary is model-generated

Recommendation for the assignment:

- start without memory if time is short
- add a small rolling summary once the core app works

### Suggested Suggestion Prompt Design

The live suggestion prompt should tell the model:

- it is assisting a user during a live meeting
- suggestions must help immediately, not summarize
- previews must be concise, specific, and actionable
- the set of 3 should be diverse when the transcript supports diversity
- suggestions should be grounded in what was actually said
- avoid generic filler like "ask for clarification" unless truly useful

It should also define when each type is appropriate:

- `question_to_ask`: when a strong follow-up would improve the conversation
- `talking_point`: when the user needs a helpful framing, comparison, or nugget
- `answer`: when someone effectively asked something and the user needs a response
- `fact_check`: when a claim seems uncertain, outdated, or risky

Important rule:

If fact-checking is not warranted, do not force a `fact_check`. Diversity should be encouraged, not mandatory at the cost of relevance.

### Example Internal Rubric For Ranking Suggestions

Ask the model to optimize for:

1. immediacy: useful in the next 10 to 30 seconds
2. specificity: tied to concrete details in the transcript
3. novelty: not repetitive with prior batch
4. actionability: something the user can say or use now
5. confidence: avoid brittle hallucinations

This rubric helps prevent generic "meeting assistant" outputs.

### Suggested Anti-Repetition Rule

Provide the model with the last 1 or 2 suggestion batches and instruct it:

- do not repeat prior cards unless new transcript evidence materially strengthens them
- prefer a new angle if the same topic is still active

This prevents the middle column from becoming three slightly reworded variants every 30 seconds.

## Detailed Answer and Chat Strategy

The detailed answer experience should feel richer than the suggestion preview.

Use a separate prompt for chat that:

- includes more transcript context than the live suggestion prompt
- includes recent chat history
- includes the selected suggestion's type and `detailedPromptSeed`
- aims to answer directly, not brainstorm more cards

### Streaming Is Important For Chat

The chat route should stream tokens to the UI because:

- it improves perceived latency
- it makes suggestion clicks feel responsive
- the evaluator will likely test this live

### Suggested Chat Context

Recommended default:

- rolling memory summary
- last 6 to 10 transcript chunks
- full session chat history, capped if needed

If transcript gets long, use a token budget rather than a fixed number of chunks.

### Suggested Chat Behavior Rules

The chat model should:

- answer directly and clearly
- reference the meeting context when useful
- avoid pretending certainty when context is missing
- provide short bullets when appropriate
- keep responses practical and meeting-oriented

For clicked suggestions, it should usually:

- expand the idea
- provide supporting detail
- give wording the user can actually say

## Session State Model

Recommended client-side state:

```ts
type SessionState = {
  startedAt: string;
  isRecording: boolean;
  isTranscribing: boolean;
  isGeneratingSuggestions: boolean;
  transcriptChunks: TranscriptChunk[];
  suggestionBatches: SuggestionBatch[];
  chatMessages: ChatMessage[];
  settings: SessionSettings;
  rollingSummary: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  text: string;
  source: "typed" | "suggestion_click" | "assistant";
  relatedSuggestionId?: string;
};

type SessionSettings = {
  groqApiKey: string;
  language: string;
  suggestionPrompt: string;
  detailedAnswerPrompt: string;
  chatPrompt: string;
  suggestionContextChunkCount: number;
  chatContextChunkCount: number;
  autoRefreshSeconds: number;
};
```

Recommended persistence:

- session data in memory
- settings in `localStorage` or `sessionStorage`

For the assignment, storing prompts and the API key in `sessionStorage` is defensible. If using `localStorage`, make the tradeoff explicit in the README.

## API Surface

Keep the backend small and explicit.

### `POST /api/transcribe`

Input:

- audio blob
- user API key
- optional language
- timestamps about chunk start/end

Output:

- normalized `TranscriptChunk`

### `POST /api/suggestions`

Input:

- user API key
- recent transcript chunks
- rolling summary
- recent suggestion batches
- optional recent chat
- prompt settings

Output:

- validated `SuggestionBatch`

### `POST /api/chat`

Input:

- user API key
- chat history
- transcript context
- rolling summary
- selected suggestion metadata or typed question
- prompt settings

Output:

- streamed assistant text

### Optional `POST /api/summary`

Only add this if you decide to maintain a model-generated rolling summary. Otherwise keep summary generation local or omit it entirely.

## Prompt and Token Budgeting

This matters because `openai/gpt-oss-120b` has strong capability but relatively limited developer-plan token throughput compared with smaller models.

For this assignment:

- the app is likely used by one evaluator at a time
- request frequency is low
- latency still matters a lot

So the main risk is not RPM. It is oversending transcript and slowing time to first token.

### Suggested Token Budget Strategy

### Suggestions

Keep the input small and high-signal:

- system prompt plus rules: 400 to 700 tokens
- rolling summary: 100 to 250 tokens
- recent transcript: 300 to 1200 tokens
- recent suggestion history: 100 to 250 tokens
- output: around 150 to 300 tokens

Target: usually under 2,000 input tokens.

### Chat

Allow more context, but still cap it:

- prompt and role instructions: 400 to 800 tokens
- rolling summary: 100 to 250 tokens
- transcript context: 800 to 2,500 tokens
- recent chat history: 300 to 1,200 tokens

Target: usually under 4,000 input tokens.

If you do not cap chat context, the app will get slower over time.

## Prompt Caching Opportunity

Because the system prompt and much of the request prefix stay stable across calls, prompt caching should help on repeated `gpt-oss-120b` calls. This is a good reason to keep:

- instruction prefixes stable
- schema stable
- prompt field ordering stable

Avoid dynamically shuffling prompt sections.

## Rate Limit Considerations

With 30-second refreshes, a single active session is well within request-per-minute limits. The main thing to guard against is token overuse from sending too much transcript or generating too much chat output.

Practical protections:

- cap transcript context
- cap max completion tokens
- debounce refresh
- serialize suggestion requests so only one is in flight
- back off gracefully on 429s

## Default Settings Worth Shipping

Suggested defaults:

- auto refresh: `30`
- transcription language: `en`
- suggestion context window: `4` chunks
- chat context window: `8` chunks
- include last `2` suggestion batches in the suggestion prompt
- suggestion temperature: low, around `0.2`
- chat temperature: low to medium, around `0.3`
- max suggestions output: small and fixed by schema
- max chat output: enough for a useful answer, not essay length

Why low temperature:

- more consistency
- less card drift
- lower risk of weird formatting or hallucinated fact-checks

## Error Handling Requirements

This app needs visible and calm error handling because live meeting tools feel untrustworthy if they fail silently.

Handle at least:

- no mic permission
- recorder unsupported browser
- empty or silence-only audio chunk
- transcription failure
- suggestion generation failure
- chat streaming interruption
- missing API key
- Groq rate limit or quota error
- invalid structured output from the model

Recommended UI behavior:

- show inline status in each column
- keep old suggestion batches visible if a new batch fails
- allow retry for chat and suggestions
- never lose already captured transcript on downstream suggestion failure

## Security and Privacy

Minimum acceptable security posture for the assignment:

- do not hard-code a Groq API key
- do not ship a build with a secret in the bundle
- proxy Groq through backend routes
- do not log raw API keys
- do not write transcript or chat to a database
- document that session data is in-memory only unless the user exports it

Because the evaluator supplies their own key, the app should clearly state:

- where the key is stored
- whether it survives refresh
- that calls are proxied server-side

## Suggested Export Format

Use JSON. It is easier to inspect and grade than plain text.

```json
{
  "session": {
    "startedAt": "2026-04-18T18:00:00.000Z",
    "endedAt": "2026-04-18T18:32:11.000Z",
    "settings": {
      "language": "en",
      "suggestionContextChunkCount": 4,
      "chatContextChunkCount": 8
    }
  },
  "transcriptChunks": [],
  "suggestionBatches": [],
  "chatMessages": [],
  "rollingSummary": ""
}
```

Include enough metadata to reconstruct why a suggestion appeared:

- suggestion timestamp
- source chunk ids
- suggestion type
- hidden rationale if available

This helps both grading and debugging.

## Frontend UX Notes From The Mockup

The mockup is intentionally simple. Follow it closely.

Important UI details:

- transcript column auto-scrolls on new chunk
- suggestions column shows newest batch first
- old suggestions remain visible but visually de-emphasized
- the preview text itself must carry value
- chat should feel continuous, not modal
- clear mic state matters more than fancy visuals

Avoid spending time inventing a different layout. The PRD explicitly discourages that.

## Testing Strategy

The fastest way to improve suggestion quality is to test against multiple meeting styles, not just one transcript.

Create a small local evaluation set:

- product planning call
- technical architecture discussion
- sales or discovery call
- interview or recruiting conversation
- status update with blockers

For each scenario, assess:

- were the 3 cards distinct
- was at least one card immediately useful
- did the click-through answer improve on the preview
- did the app avoid repetitive generic advice

## Manual QA Checklist

- start mic, speak, wait 30 seconds, transcript appears
- suggestions appear immediately after transcript chunk
- refresh while recording flushes and resumes correctly
- click suggestion streams a detailed answer
- typed chat works after several suggestion clicks
- export includes all transcript, suggestions, and chat
- reload resets session but keeps settings only if intended
- no API key present in client bundle or repo

## Practical Build Sequence

Build in this order:

1. reproduce the 3-column UI from the mockup
2. implement settings with user-provided Groq key
3. implement `MediaRecorder` chunk capture
4. implement `/api/transcribe`
5. render transcript chunks with timestamps
6. implement `/api/suggestions` with strict schema
7. render suggestion batches newest-first
8. implement click-to-chat with streaming
9. add manual refresh flush behavior
10. add export
11. refine prompts and context windows
12. test across several meeting scenarios

This sequence gets the core loop working early.

## What Not To Over-Engineer

Avoid these traps:

- adding a database
- adding authentication
- adding multi-user collaboration
- doing websocket-based audio streaming
- building agentic multi-step suggestion pipelines before basic quality is proven
- spending too much time on custom design systems
- adding retrieval or vector search without evidence it helps this assignment

The app should feel sharp and reliable, not "enterprise".

## Recommended Final Architecture Summary

If I were building this for the assignment, I would choose:

- Next.js + TypeScript
- backend proxy routes for Groq
- `MediaRecorder` with 30-second chunks
- `whisper-large-v3` transcription with `verbose_json`
- strict JSON schema suggestions using `openai/gpt-oss-120b`
- streamed chat answers using the same `openai/gpt-oss-120b`
- bounded recent transcript context
- optional small rolling summary if time allows
- JSON export with full session state

That is enough to score well if the prompts are strong and the product loop feels fast.

## Key Decisions To Defend In Review

If asked why you built it this way, the strongest answers are:

- 30-second chunking matches both the PRD and Whisper's sweet spot
- suggestions use strict schema because exact count and structure matter more than streaming
- chat uses streaming because perceived latency matters there
- transcript context is bounded to protect latency and rate limits
- manual refresh should use only already-transcribed visible transcript context
- the API key is user-supplied and proxied server-side because frontend key exposure is a bad practice

## Official References Worth Consulting During Implementation

- Groq Speech-to-Text docs
- Groq Text Generation docs
- Groq Structured Outputs docs
- Groq Rate Limits docs
- Groq Prompt Caching docs
- Groq Security Onboarding docs
- Groq model pages for `whisper-large-v3` and `openai/gpt-oss-120b`

## Final Recommendation

The winning version of this assignment is not the one with the most infrastructure. It is the one where:

- transcript updates are dependable
- suggestion cards are precise and varied
- click-through answers feel stronger than the preview
- latency stays low
- the evaluator can inspect exported session data and understand how the app behaved

Build the smallest system that makes the live suggestion loop excellent.
