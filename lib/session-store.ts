"use client";

import { create } from "zustand";
import type {
  ChatMessage,
  SessionSettings,
  SessionState,
  SuggestionBatch,
  TranscriptChunk,
} from "@/types/session";
import {
  DEFAULT_CHAT_PROMPT,
  DEFAULT_DETAILED_ANSWER_PROMPT,
  DEFAULT_SUGGESTION_PROMPT,
} from "@/lib/prompts";

const defaultSettings: SessionSettings = {
  groqApiKey: "",
  language: "en",
  autoRefreshSeconds: 30,
  suggestionContextChunkCount: 2,
  lightingMode: true,
  chatContextChunkCount: 4,
  suggestionPrompt: DEFAULT_SUGGESTION_PROMPT,
  detailedAnswerPrompt: DEFAULT_DETAILED_ANSWER_PROMPT,
  chatPrompt: DEFAULT_CHAT_PROMPT,
};

function normalizeSettings(settings: Partial<SessionSettings>): SessionSettings {
  return {
    ...defaultSettings,
    ...settings,
  };
}

type SessionFlags = Pick<
  SessionState,
  | "isRecording"
  | "isTranscribing"
  | "isGeneratingSuggestions"
  | "isChatStreaming"
>;

type Store = SessionState & {
  setSettingsOpen: (open: boolean) => void;
  setSettings: (settings: SessionSettings) => void;
  hydrateSettings: (settings: SessionSettings) => void;
  addTranscriptChunk: (chunk: TranscriptChunk) => void;
  mergeLastTranscriptChunk: (chunk: TranscriptChunk) => void;
  addSuggestionBatch: (batch: SuggestionBatch) => void;
  addChatMessage: (message: ChatMessage) => void;
  replaceLastAssistantMessage: (text: string) => void;
  appendLastAssistantMessage: (text: string) => void;
  setRollingSummary: (summary: string) => void;
  setFlags: (flags: Partial<SessionFlags>) => void;
  setError: (error: string) => void;
  clearSessionError: () => void;
};

export const useSessionStore = create<Store>((set) => ({
  startedAt: new Date().toISOString(),
  transcriptChunks: [],
  suggestionBatches: [],
  chatMessages: [],
  rollingSummary: "",
  settings: defaultSettings,
  isRecording: false,
  isTranscribing: false,
  isGeneratingSuggestions: false,
  isChatStreaming: false,
  isSettingsOpen: false,
  error: "",
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  setSettings: (settings) => set({ settings: normalizeSettings(settings) }),
  hydrateSettings: (settings) => set({ settings: normalizeSettings(settings) }),
  addTranscriptChunk: (chunk) =>
    set((state) => ({
      transcriptChunks: [...state.transcriptChunks, chunk],
    })),
  mergeLastTranscriptChunk: (chunk) =>
    set((state) => {
      const lastChunk = state.transcriptChunks.at(-1);
      if (!lastChunk) {
        return {
          transcriptChunks: [...state.transcriptChunks, chunk],
        };
      }

      const baseStartMs = Date.parse(lastChunk.startedAt);
      const nextStartMs = Date.parse(chunk.startedAt);
      const offsetSec =
        Number.isFinite(baseStartMs) && Number.isFinite(nextStartMs)
          ? Math.max(0, (nextStartMs - baseStartMs) / 1000)
          : 0;

      const mergedChunk: TranscriptChunk = {
        ...lastChunk,
        endedAt: chunk.endedAt,
        text: [lastChunk.text.trim(), chunk.text.trim()].filter(Boolean).join(" "),
        segments: [
          ...lastChunk.segments,
          ...chunk.segments.map((segment) => ({
            ...segment,
            startSec: segment.startSec + offsetSec,
            endSec: segment.endSec + offsetSec,
          })),
        ],
      };

      return {
        transcriptChunks: [...state.transcriptChunks.slice(0, -1), mergedChunk],
      };
    }),
  addSuggestionBatch: (batch) =>
    set((state) => ({
      suggestionBatches: [batch, ...state.suggestionBatches],
    })),
  addChatMessage: (message) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, message],
    })),
  replaceLastAssistantMessage: (text) =>
    set((state) => {
      const chatMessages = [...state.chatMessages];
      const last = chatMessages.at(-1);
      if (!last || last.role !== "assistant") {
        return state;
      }
      chatMessages[chatMessages.length - 1] = { ...last, text };
      return { chatMessages };
    }),
  appendLastAssistantMessage: (text) =>
    set((state) => {
      const chatMessages = [...state.chatMessages];
      const last = chatMessages.at(-1);
      if (!last || last.role !== "assistant") {
        return state;
      }
      chatMessages[chatMessages.length - 1] = {
        ...last,
        text: `${last.text}${text}`,
      };
      return { chatMessages };
    }),
  setRollingSummary: (rollingSummary) => set({ rollingSummary }),
  setFlags: (flags) => set(flags),
  setError: (error) => set({ error }),
  clearSessionError: () => set({ error: "" }),
}));

export function getDefaultSettings() {
  return defaultSettings;
}
