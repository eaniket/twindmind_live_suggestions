"use client";

import { useEffect, useRef } from "react";
import { useSessionStore } from "@/lib/session-store";
import { MicButton } from "@/components/mic-button";
import { useSessionController } from "@/lib/session-controller";
import { formatTime } from "@/lib/time";

export function TranscriptPanel() {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const transcriptChunks = useSessionStore((state) => state.transcriptChunks);
  const isRecording = useSessionStore((state) => state.isRecording);
  const isTranscribing = useSessionStore((state) => state.isTranscribing);
  const toggleRecording = useSessionController().toggleRecording;

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    body.scrollTop = body.scrollHeight;
  }, [transcriptChunks, isRecording]);

  const status = isTranscribing ? "transcribing" : isRecording ? "● recording" : "idle";

  return (
    <section className="panel">
      <header className="panel-header">
        <span>1. Mic & Transcript</span>
        <span>{status}</span>
      </header>
      <div className="mic-row">
        <MicButton
          disabled={isTranscribing}
          onClick={() => void toggleRecording()}
          isRecording={isRecording}
        />
        <div className="muted-text">
          {isRecording
            ? "Listening. Transcript updates every ~30s."
            : "Click mic to start. Transcript appends every ~30s."}
        </div>
      </div>
      <div className="panel-body" ref={bodyRef}>
        <div className="banner">
          The transcript scrolls and appends new chunks every ~30 seconds while
          recording. Use the mic button to start or stop. Export includes the full
          session.
        </div>
        {transcriptChunks.length === 0 && !isRecording ? (
          <div className="empty">No transcript yet — start the mic.</div>
        ) : null}
        {transcriptChunks.map((chunk, chunkIndex) => (
          <div
            className={`transcript-line${chunkIndex === transcriptChunks.length - 1 ? " is-latest" : " is-stale"}`}
            key={chunk.id}
          >
            <time>{formatTime(chunk.createdAt)}</time>
            {chunk.text}
          </div>
        ))}
        {isRecording ? (
          <div className="transcript-pending" aria-live="polite">
            <span className="animated-ellipsis" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
