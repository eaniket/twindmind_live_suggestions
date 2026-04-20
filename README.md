# TwinMind Live Suggestions

Web app for the TwinMind live suggestions assignment. It captures microphone audio in chunks, transcribes with Groq Whisper, generates 3 live suggestions, and expands suggestions into streamed chat answers.

## Stack

- Next.js 15
- React 19
- TypeScript
- Zustand
- Zod
- Groq SDK

## Setup

```bash
npm install
npm run dev
```

Open the app, paste a Groq API key in Settings, then start the mic.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run typecheck
```

## Prompt Strategy

- Suggestions use `openai/gpt-oss-120b` with strict JSON schema output so the UI always gets exactly 3 cards.
- Suggestion context is bounded to recent transcript chunks plus recent suggestion history to reduce repetition and control latency.
- Clicked suggestions and typed chat use a separate prompt with more transcript context and streaming enabled.
- Transcription uses `whisper-large-v3` with `verbose_json` and segment timestamps.

## Tradeoffs

- Session data is in memory only; no database and no login.
- Settings are stored in `sessionStorage` for the active tab.
- Rolling summary is lightweight and local to avoid an extra model call on every chunk.
- Manual refresh only uses already-visible transcript context and does not flush the active recording chunk.
