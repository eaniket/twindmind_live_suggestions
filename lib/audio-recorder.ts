export type RecordedChunk = {
  blob: Blob;
  startedAt: string;
  endedAt: string;
};

type RecorderController = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  flush: () => Promise<RecordedChunk | null>;
  dispose: () => void;
};

export function createChunkRecorder(
  onChunk: (chunk: RecordedChunk) => Promise<void>,
  chunkMs: number,
): RecorderController {
  let stream: MediaStream | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let timeoutId = 0;
  let startedAt = "";
  let pendingFlushResolve:
    | ((chunk: RecordedChunk | null) => void)
    | null = null;

  const clearTimer = () => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutId = 0;
    }
  };

  const start = async () => {
    stream ??= await navigator.mediaDevices.getUserMedia({ audio: true });

    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder is not supported in this browser");
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    startedAt = new Date().toISOString();
    const chunks: BlobPart[] = [];

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size) {
        chunks.push(event.data);
      }
    };
    mediaRecorder.onstop = () => {
      const chunk: RecordedChunk = {
        blob: new Blob(chunks, { type: mimeType }),
        startedAt,
        endedAt: new Date().toISOString(),
      };
      if (pendingFlushResolve) {
        pendingFlushResolve(chunk.blob.size ? chunk : null);
        pendingFlushResolve = null;
        return;
      }
      if (chunk.blob.size) {
        void onChunk(chunk);
      }
    };
    mediaRecorder.start();
    timeoutId = window.setTimeout(() => {
      mediaRecorder?.stop();
    }, chunkMs);
  };

  const stop = async () => {
    clearTimer();
    if (mediaRecorder?.state === "recording") {
      mediaRecorder.stop();
    }
  };

  const flush = async () => {
    clearTimer();
    const recorder = mediaRecorder;
    if (!recorder || recorder.state !== "recording") {
      return null;
    }
    return new Promise<RecordedChunk | null>((resolve) => {
      pendingFlushResolve = resolve;
      recorder.stop();
    });
  };

  const dispose = () => {
    clearTimer();
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    mediaRecorder = null;
  };

  return { start, stop, flush, dispose };
}
