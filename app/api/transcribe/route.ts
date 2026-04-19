import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

type VerboseTranscriptionSegment = {
  start?: number;
  end?: number;
  text?: string;
};

type VerboseTranscription = {
  text?: string;
  segments?: VerboseTranscriptionSegment[];
};

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const apiKey = String(formData.get("apiKey") ?? "");
  const file = formData.get("file");
  const language = String(formData.get("language") ?? "en");
  const startedAt = String(formData.get("startedAt") ?? "");
  const endedAt = String(formData.get("endedAt") ?? "");
  const source = String(formData.get("source") ?? "auto");

  if (!apiKey || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing apiKey or audio file" },
      { status: 400 },
    );
  }

  try {
    const groq = new Groq({ apiKey });
    const result = (await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3",
      language,
      response_format: "verbose_json",
      temperature: 0,
      timestamp_granularities: ["segment"],
    })) as VerboseTranscription;

    return NextResponse.json({
      id: randomUUID(),
      startedAt,
      endedAt,
      createdAt: new Date().toISOString(),
      text: result.text ?? "",
      source: source === "manual-flush" ? "manual-flush" : "auto",
      segments: (result.segments ?? []).map((segment) => ({
        startSec: segment.start ?? 0,
        endSec: segment.end ?? 0,
        text: segment.text ?? "",
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Transcription request failed",
      },
      { status: 500 },
    );
  }
}
