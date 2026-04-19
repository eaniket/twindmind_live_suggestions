"use client";

import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createChunkRecorder, type RecordedChunk } from "@/lib/audio-recorder";
import {
  loadSuggestions,
  streamChatResponse,
  transcribeChunk,
} from "@/lib/api-client";
import {
  buildSuggestionContext,
  formatChatHistory,
  formatSuggestionHistory,
  formatTranscriptChunks,
} from "@/lib/context";
import { useSessionStore } from "@/lib/session-store";
import { buildRollingSummary } from "@/lib/summary";
import type { Suggestion } from "@/types/session";

type SessionControllerValue = {
  countdown: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  toggleRecording: () => Promise<void>;
  refreshSuggestions: () => Promise<void>;
  sendChatMessage: (message: string) => Promise<void>;
  clickSuggestion: (suggestion: Suggestion) => Promise<void>;
};

const SessionControllerContext = createContext<SessionControllerValue | null>(
  null,
);

function useSessionControllerValue(): SessionControllerValue {
  const countdownRef = useRef(30);
  const nextRefreshAtRef = useRef<number | null>(null);
  const recorderRef = useRef<ReturnType<typeof createChunkRecorder> | null>(null);
  const isRecordingRef = useRef(false);
  const [countdown, setCountdown] = useState(30);

  const setFlags = useSessionStore((state) => state.setFlags);
  const setError = useSessionStore((state) => state.setError);
  const clearSessionError = useSessionStore((state) => state.clearSessionError);
  const addTranscriptChunk = useSessionStore((state) => state.addTranscriptChunk);
  const addSuggestionBatch = useSessionStore((state) => state.addSuggestionBatch);
  const addChatMessage = useSessionStore((state) => state.addChatMessage);
  const appendLastAssistantMessage = useSessionStore(
    (state) => state.appendLastAssistantMessage,
  );
  const setRollingSummary = useSessionStore((state) => state.setRollingSummary);

  const resetCountdown = () => {
    const seconds = useSessionStore.getState().settings.autoRefreshSeconds;
    countdownRef.current = seconds;
    nextRefreshAtRef.current = Date.now() + seconds * 1000;
    setCountdown(seconds);
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      const { isRecording, settings } = useSessionStore.getState();
      if (!isRecording) {
        countdownRef.current = settings.autoRefreshSeconds;
        nextRefreshAtRef.current = null;
        setCountdown(settings.autoRefreshSeconds);
        return;
      }
      const nextRefreshAt = nextRefreshAtRef.current;
      if (!nextRefreshAt) {
        resetCountdown();
        return;
      }
      const remainingSeconds = Math.max(
        0,
        Math.ceil((nextRefreshAt - Date.now()) / 1000),
      );
      countdownRef.current = remainingSeconds;
      setCountdown(remainingSeconds);
    }, 250);

    return () => {
      window.clearInterval(interval);
      recorderRef.current?.dispose();
    };
  }, []);

  const ensureApiKey = () => {
    const apiKey = useSessionStore.getState().settings.groqApiKey.trim();
    if (!apiKey) {
      throw new Error("Add your Groq API key in settings before using the app");
    }
  };

  const createRecorderIfNeeded = () => {
    if (recorderRef.current) {
      return recorderRef.current;
    }

    const recorder = createChunkRecorder(async (chunk) => {
      await transcribeAndMaybeContinue(chunk, "auto");
    }, useSessionStore.getState().settings.autoRefreshSeconds * 1000);

    recorderRef.current = recorder;
    return recorder;
  };

  const generateSuggestions = async () => {
    const state = useSessionStore.getState();
    if (!state.transcriptChunks.length) {
      return;
    }

    setFlags({ isGeneratingSuggestions: true });
    try {
      const context = buildSuggestionContext({
        transcriptChunks: state.transcriptChunks,
        suggestionBatches: state.suggestionBatches,
        chatMessages: state.chatMessages,
        transcriptLimit: state.settings.suggestionContextChunkCount,
        includeChat: state.settings.includeChatInSuggestions,
      });

      const batch = await loadSuggestions({
        apiKey: state.settings.groqApiKey,
        rollingSummary: state.rollingSummary,
        transcriptText: formatTranscriptChunks(context.recentChunks),
        recentSuggestions: formatSuggestionHistory(
          context.recentSuggestionBatches,
        ),
        basedOnChunkIds: context.recentChunks.map((chunk) => chunk.id),
        prompt: state.settings.suggestionPrompt,
      });

      addSuggestionBatch(batch);
      resetCountdown();
    } finally {
      setFlags({ isGeneratingSuggestions: false });
    }
  };

  const transcribeAndMaybeContinue = async (
    chunk: RecordedChunk,
    source: "auto" | "manual-flush",
  ) => {
    const state = useSessionStore.getState();
    setFlags({ isTranscribing: true });
    try {
      const transcriptChunk = await transcribeChunk({
        blob: chunk.blob,
        apiKey: state.settings.groqApiKey,
        language: state.settings.language,
        startedAt: chunk.startedAt,
        endedAt: chunk.endedAt,
        source,
      });

      if (transcriptChunk.text.trim()) {
        addTranscriptChunk(transcriptChunk);
        const nextChunks = useSessionStore.getState().transcriptChunks;
        setRollingSummary(buildRollingSummary(nextChunks));
        await generateSuggestions();
      }
    } finally {
      setFlags({ isTranscribing: false });
    }

    if (isRecordingRef.current && source === "auto") {
      await createRecorderIfNeeded().start();
      resetCountdown();
    }
  };

  const startRecording = async () => {
    ensureApiKey();
    clearSessionError();
    isRecordingRef.current = true;
    setFlags({ isRecording: true });
    resetCountdown();
    await createRecorderIfNeeded().start();
  };

  const stopRecording = async () => {
    isRecordingRef.current = false;
    setFlags({ isRecording: false });
    const pending = await recorderRef.current?.flush();
    if (pending) {
      await transcribeAndMaybeContinue(pending, "manual-flush");
    }
  };

  const toggleRecording = async () => {
    try {
      if (useSessionStore.getState().isRecording) {
        await stopRecording();
        return;
      }
      await startRecording();
    } catch (error) {
      setFlags({ isRecording: false, isTranscribing: false });
      isRecordingRef.current = false;
      setError(error instanceof Error ? error.message : "Recording failed");
    }
  };

  const refreshSuggestions = async () => {
    clearSessionError();
    const state = useSessionStore.getState();
    if (state.isTranscribing || state.isGeneratingSuggestions) {
      return;
    }

    try {
      if (state.isRecording) {
        const pending = await recorderRef.current?.flush();
        if (pending) {
          await transcribeAndMaybeContinue(pending, "manual-flush");
        } else {
          await generateSuggestions();
        }
        if (isRecordingRef.current) {
          await createRecorderIfNeeded().start();
        }
        return;
      }
      await generateSuggestions();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Refresh failed");
    }
  };

  const sendChatMessage = async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }
    ensureApiKey();
    clearSessionError();

    const state = useSessionStore.getState();
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();

    addChatMessage({
      id: userId,
      role: "user",
      createdAt: new Date().toISOString(),
      text: trimmed,
      source: "typed",
    });
    addChatMessage({
      id: assistantId,
      role: "assistant",
      createdAt: new Date().toISOString(),
      text: "",
      source: "assistant",
    });

    setFlags({ isChatStreaming: true });
    try {
      await streamChatResponse(
        {
          apiKey: state.settings.groqApiKey,
          rollingSummary: state.rollingSummary,
          transcriptText: formatTranscriptChunks(
            state.transcriptChunks.slice(-state.settings.chatContextChunkCount),
          ),
          chatMessages: state.chatMessages.map((chatMessage) => ({
            role: chatMessage.role,
            content: chatMessage.text,
          })),
          prompt: state.settings.chatPrompt,
          userMessage: trimmed,
        },
        appendLastAssistantMessage,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Chat failed");
    } finally {
      setFlags({ isChatStreaming: false });
    }
  };

  const clickSuggestion = async (suggestion: Suggestion) => {
    const state = useSessionStore.getState();
    const seed = [
      `Suggestion type: ${suggestion.type}`,
      `Suggestion preview: ${suggestion.preview}`,
      `Expand on this for the user: ${suggestion.detailedPromptSeed}`,
      formatChatHistory(state.chatMessages.slice(-4)),
    ]
      .filter(Boolean)
      .join("\n\n");

    addChatMessage({
      id: crypto.randomUUID(),
      role: "user",
      createdAt: new Date().toISOString(),
      text: suggestion.preview,
      source: "suggestion_click",
      relatedSuggestionId: suggestion.id,
    });
    addChatMessage({
      id: crypto.randomUUID(),
      role: "assistant",
      createdAt: new Date().toISOString(),
      text: "",
      source: "assistant",
      relatedSuggestionId: suggestion.id,
    });

    setFlags({ isChatStreaming: true });
    try {
      await streamChatResponse(
        {
          apiKey: state.settings.groqApiKey,
          rollingSummary: state.rollingSummary,
          transcriptText: formatTranscriptChunks(
            state.transcriptChunks.slice(-state.settings.chatContextChunkCount),
          ),
          chatMessages: state.chatMessages.map((chatMessage) => ({
            role: chatMessage.role,
            content: chatMessage.text,
          })),
          prompt: state.settings.detailedAnswerPrompt,
          userMessage: seed,
        },
        appendLastAssistantMessage,
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Suggestion expansion failed",
      );
    } finally {
      setFlags({ isChatStreaming: false });
    }
  };

  return {
    countdown,
    startRecording,
    stopRecording,
    toggleRecording,
    refreshSuggestions,
    sendChatMessage,
    clickSuggestion,
  };
}

export function SessionControllerProvider({
  children,
}: PropsWithChildren) {
  const value = useSessionControllerValue();
  return (
    <SessionControllerContext.Provider value={value}>
      {children}
    </SessionControllerContext.Provider>
  );
}

export function useSessionController() {
  const value = useContext(SessionControllerContext);
  if (!value) {
    throw new Error("useSessionController must be used inside the provider");
  }
  return value;
}
