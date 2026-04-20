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
import { readStoredApiKey } from "@/lib/settings-storage";
import { buildRollingSummary } from "@/lib/summary";
import type {
  Suggestion,
  SuggestionBatch,
  SessionState,
  TranscriptChunk,
} from "@/types/session";

type SessionControllerValue = {
  countdown: number;
  isReloadBusy: boolean;
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

type SuggestionSnapshot = {
  apiKey: string;
  rollingSummary: string;
  transcriptText: string;
  recentSuggestions: string;
  basedOnChunkIds: string[];
  prompt: string;
  signature: string;
};

type PendingAutoRefresh = {
  token: number;
  deadline: number;
  transcriptChunk: TranscriptChunk | null;
  rollingSummary: string;
  batch: SuggestionBatch | null;
  error: string;
  status: "prefetching" | "ready";
};

const AUTO_PREFETCH_LEAD_MS = 5_000;

function useSessionControllerValue(): SessionControllerValue {
  const countdownRef = useRef(30);
  const nextRefreshAtRef = useRef<number | null>(null);
  const recorderRef = useRef<ReturnType<typeof createChunkRecorder> | null>(null);
  const isRecordingRef = useRef(false);
  const isManualRefreshRef = useRef(false);
  const autoRefreshTokenRef = useRef(0);
  const pendingAutoRefreshRef = useRef<PendingAutoRefresh | null>(null);
  const [countdown, setCountdown] = useState(30);
  const [isReloadBusy, setIsReloadBusy] = useState(false);

  const setFlags = useSessionStore((state) => state.setFlags);
  const setError = useSessionStore((state) => state.setError);
  const clearSessionError = useSessionStore((state) => state.clearSessionError);
  const addTranscriptChunk = useSessionStore((state) => state.addTranscriptChunk);
  const mergeLastTranscriptChunk = useSessionStore(
    (state) => state.mergeLastTranscriptChunk,
  );
  const addSuggestionBatch = useSessionStore((state) => state.addSuggestionBatch);
  const addChatMessage = useSessionStore((state) => state.addChatMessage);
  const appendLastAssistantMessage = useSessionStore(
    (state) => state.appendLastAssistantMessage,
  );
  const setRollingSummary = useSessionStore((state) => state.setRollingSummary);

  const scheduleNextRefresh = (baseTime = Date.now()) => {
    const seconds = useSessionStore.getState().settings.autoRefreshSeconds;
    countdownRef.current = seconds;
    nextRefreshAtRef.current = baseTime + seconds * 1000;
    setCountdown(seconds);
  };

  const invalidatePendingAutoRefresh = () => {
    autoRefreshTokenRef.current += 1;
    pendingAutoRefreshRef.current = null;
    setIsReloadBusy(false);
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      const state = useSessionStore.getState();
      const shouldRunCountdown = state.isRecording;
      if (!shouldRunCountdown) {
        countdownRef.current = state.settings.autoRefreshSeconds;
        nextRefreshAtRef.current = null;
        setCountdown(state.settings.autoRefreshSeconds);
        return;
      }
      if (isManualRefreshRef.current) {
        return;
      }
      const nextRefreshAt = nextRefreshAtRef.current;
      if (!nextRefreshAt) {
        scheduleNextRefresh();
        return;
      }
      const remainingSeconds = Math.max(
        0,
        Math.ceil((nextRefreshAt - Date.now()) / 1000),
      );
      countdownRef.current = remainingSeconds;
      setCountdown(remainingSeconds);

      const remainingMs = nextRefreshAt - Date.now();
      const pendingAutoRefresh = pendingAutoRefreshRef.current;
      const lightingMode = state.settings.lightingMode;
      if (
        lightingMode &&
        remainingMs > 0 &&
        remainingMs <= AUTO_PREFETCH_LEAD_MS &&
        (!pendingAutoRefresh || pendingAutoRefresh.deadline !== nextRefreshAt)
      ) {
        void prefetchAutoRefresh(nextRefreshAt);
      }

      if (remainingMs <= 0 && (lightingMode || pendingAutoRefresh)) {
        commitPendingAutoRefresh(nextRefreshAt);
      }
    }, 250);

    return () => {
      window.clearInterval(interval);
      recorderRef.current?.dispose();
    };
  }, []);

  const ensureApiKey = () => {
    const apiKey =
      useSessionStore.getState().settings.groqApiKey.trim() || readStoredApiKey();
    if (!apiKey) {
      throw new Error("Add your Groq API key in settings before using the app");
    }
  };

  const buildSuggestionSnapshot = (
    state: SessionState,
    overrides?: Partial<
      Pick<
        SessionState,
        "transcriptChunks" | "suggestionBatches" | "chatMessages" | "rollingSummary"
      >
    >,
  ): SuggestionSnapshot | null => {
    const transcriptChunks = overrides?.transcriptChunks ?? state.transcriptChunks;
    const suggestionBatches =
      overrides?.suggestionBatches ?? state.suggestionBatches;
    const chatMessages = overrides?.chatMessages ?? state.chatMessages;
    const rollingSummary = overrides?.rollingSummary ?? state.rollingSummary;

    if (!transcriptChunks.length) {
      return null;
    }

    const context = buildSuggestionContext({
      transcriptChunks,
      suggestionBatches,
      chatMessages,
      transcriptLimit: state.settings.suggestionContextChunkCount,
      includeChat: true,
    });

    const transcriptText = formatTranscriptChunks(context.recentChunks);
    const recentSuggestions = formatSuggestionHistory(
      context.recentSuggestionBatches,
    );
    const basedOnChunkIds = context.recentChunks.map((chunk) => chunk.id);
    const signature = [
      basedOnChunkIds.join(","),
      transcriptText,
      recentSuggestions,
      rollingSummary,
      state.settings.suggestionPrompt,
    ].join("::");

    return {
      apiKey: state.settings.groqApiKey,
      rollingSummary,
      transcriptText,
      recentSuggestions,
      basedOnChunkIds,
      prompt: state.settings.suggestionPrompt,
      signature,
    };
  };

  const requestSuggestionBatch = async (snapshot: SuggestionSnapshot) =>
    loadSuggestions({
      apiKey: snapshot.apiKey,
      rollingSummary: snapshot.rollingSummary,
      transcriptText: snapshot.transcriptText,
      recentSuggestions: snapshot.recentSuggestions,
      basedOnChunkIds: snapshot.basedOnChunkIds,
      prompt: snapshot.prompt,
    });

  const loadSuggestionBatch = async (
    snapshot: SuggestionSnapshot,
    options?: { visible?: boolean },
  ) => {
    if (options?.visible) {
      setFlags({ isGeneratingSuggestions: true });
    }

    try {
      return await requestSuggestionBatch(snapshot);
    } finally {
      if (options?.visible) {
        setFlags({ isGeneratingSuggestions: false });
      }
    }
  };

  const requestTranscriptChunk = async (
    chunk: RecordedChunk,
    source: "auto" | "manual-flush",
  ) => {
    const state = useSessionStore.getState();
    return transcribeChunk({
      blob: chunk.blob,
      apiKey: state.settings.groqApiKey,
      language: state.settings.language,
      startedAt: chunk.startedAt,
      endedAt: chunk.endedAt,
      source,
    });
  };

  const commitTranscriptChunk = (
    transcriptChunk: TranscriptChunk,
    options?: { mergeIntoLastChunk?: boolean },
  ) => {
    if (options?.mergeIntoLastChunk) {
      mergeLastTranscriptChunk(transcriptChunk);
    } else {
      addTranscriptChunk(transcriptChunk);
    }
    const nextChunks = useSessionStore.getState().transcriptChunks;
    setRollingSummary(buildRollingSummary(nextChunks));
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

  const startRecorderCycle = async (options?: { resetCountdown?: boolean }) => {
    await createRecorderIfNeeded().start();
    if (options?.resetCountdown !== false) {
      scheduleNextRefresh();
    }
  };

  const generateSuggestions = async (snapshot?: SuggestionSnapshot) => {
    const nextSnapshot = snapshot ?? buildSuggestionSnapshot(useSessionStore.getState());
    if (!nextSnapshot) {
      return;
    }

    const batch = await loadSuggestionBatch(nextSnapshot, { visible: true });
    addSuggestionBatch(batch);
  };

  const commitPendingAutoRefresh = (deadline: number) => {
    const pendingAutoRefresh = pendingAutoRefreshRef.current;
    if (!pendingAutoRefresh || pendingAutoRefresh.deadline !== deadline) {
      return;
    }

    if (pendingAutoRefresh.status !== "ready") {
      setIsReloadBusy(true);
      return;
    }

    pendingAutoRefreshRef.current = null;
    setIsReloadBusy(false);

    if (pendingAutoRefresh.transcriptChunk?.text.trim()) {
      addTranscriptChunk(pendingAutoRefresh.transcriptChunk);
      setRollingSummary(pendingAutoRefresh.rollingSummary);
    }

    if (pendingAutoRefresh.batch) {
      addSuggestionBatch(pendingAutoRefresh.batch);
    }

    if (pendingAutoRefresh.error) {
      setError(pendingAutoRefresh.error);
    }

    scheduleNextRefresh(deadline);
    if (isRecordingRef.current) {
      void flushBridgeChunkAfterAutoRefresh();
    }
  };

  const flushBridgeChunkAfterAutoRefresh = async () => {
    const pending = await recorderRef.current?.flush();
    if (!isRecordingRef.current) {
      return;
    }

    try {
      await startRecorderCycle({ resetCountdown: false });
    } catch (error) {
      isRecordingRef.current = false;
      setFlags({ isRecording: false });
      setError(
        error instanceof Error
          ? error.message
          : "Recording could not resume after auto refresh",
      );
      return;
    }

    if (!pending) {
      return;
    }

    setFlags({ isTranscribing: true });
    try {
      const transcriptChunk = await requestTranscriptChunk(pending, "auto");
      if (transcriptChunk.text.trim()) {
        commitTranscriptChunk(transcriptChunk, { mergeIntoLastChunk: true });
      }
    } finally {
      setFlags({ isTranscribing: false });
    }
  };

  const prefetchAutoRefresh = async (deadline: number) => {
    const currentPending = pendingAutoRefreshRef.current;
    if (currentPending?.deadline === deadline) {
      return;
    }

    const token = autoRefreshTokenRef.current + 1;
    autoRefreshTokenRef.current = token;
    pendingAutoRefreshRef.current = {
      token,
      deadline,
      transcriptChunk: null,
      rollingSummary: useSessionStore.getState().rollingSummary,
      batch: null,
      error: "",
      status: "prefetching",
    };

    let transcriptChunk: TranscriptChunk | null = null;
    let rollingSummary = useSessionStore.getState().rollingSummary;

    try {
      const pendingChunk = await recorderRef.current?.flush();
      if (autoRefreshTokenRef.current !== token || !isRecordingRef.current) {
        return;
      }

      await startRecorderCycle({ resetCountdown: false });
      if (autoRefreshTokenRef.current !== token || !isRecordingRef.current) {
        return;
      }

      const state = useSessionStore.getState();
      let transcriptChunks = state.transcriptChunks;

      if (pendingChunk) {
        const nextTranscriptChunk = await requestTranscriptChunk(pendingChunk, "auto");

        if (autoRefreshTokenRef.current !== token || !isRecordingRef.current) {
          return;
        }

        if (nextTranscriptChunk.text.trim()) {
          transcriptChunk = nextTranscriptChunk;
          transcriptChunks = [...state.transcriptChunks, nextTranscriptChunk];
          rollingSummary = buildRollingSummary(transcriptChunks);
        }
      }

      const snapshot = buildSuggestionSnapshot(useSessionStore.getState(), {
        transcriptChunks,
        rollingSummary,
      });

      const batch = snapshot ? await loadSuggestionBatch(snapshot) : null;
      if (autoRefreshTokenRef.current !== token || !isRecordingRef.current) {
        return;
      }

      pendingAutoRefreshRef.current = {
        token,
        deadline,
        transcriptChunk,
        rollingSummary,
        batch,
        error: "",
        status: "ready",
      };
    } catch (error) {
      if (autoRefreshTokenRef.current !== token) {
        return;
      }

      pendingAutoRefreshRef.current = {
        token,
        deadline,
        transcriptChunk,
        rollingSummary,
        batch: null,
        error: error instanceof Error ? error.message : "Auto refresh failed",
        status: "ready",
      };
    }

    if (nextRefreshAtRef.current === deadline && Date.now() >= deadline) {
      commitPendingAutoRefresh(deadline);
    }
  };

  const transcribeAndMaybeContinue = async (
    chunk: RecordedChunk,
    source: "auto" | "manual-flush",
  ) => {
    if (source === "auto" && isRecordingRef.current) {
      await startRecorderCycle();
    }

    const state = useSessionStore.getState();
    setFlags({ isTranscribing: true });
    try {
      const transcriptChunk = await requestTranscriptChunk(chunk, source);

      if (transcriptChunk.text.trim()) {
        commitTranscriptChunk(transcriptChunk);
        await generateSuggestions();
      }
    } finally {
      setFlags({ isTranscribing: false });
    }
  };

  const startRecording = async () => {
    ensureApiKey();
    clearSessionError();
    invalidatePendingAutoRefresh();
    isRecordingRef.current = true;
    setFlags({ isRecording: true });
    await startRecorderCycle();
  };

  const stopRecording = async () => {
    invalidatePendingAutoRefresh();
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
      ensureApiKey();
      invalidatePendingAutoRefresh();

      if (!state.isRecording) {
        const snapshot = buildSuggestionSnapshot(state);
        await generateSuggestions(snapshot ?? undefined);
        return;
      }

      isManualRefreshRef.current = true;
      nextRefreshAtRef.current = null;

      const pending = await recorderRef.current?.flush();

      if (pending) {
        await transcribeAndMaybeContinue(pending, "manual-flush");
      } else {
        const snapshot = buildSuggestionSnapshot(useSessionStore.getState());
        await generateSuggestions(snapshot ?? undefined);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      if (state.isRecording && isRecordingRef.current) {
        try {
          await startRecorderCycle();
        } catch (error) {
          isRecordingRef.current = false;
          setFlags({ isRecording: false });
          setError(
            error instanceof Error
              ? error.message
              : "Recording could not resume after refresh",
          );
        }
      }
      isManualRefreshRef.current = false;
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
    isReloadBusy,
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
