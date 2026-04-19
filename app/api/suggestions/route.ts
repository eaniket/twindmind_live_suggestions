import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createGroqClient } from "@/lib/groq";
import { suggestionBatchSchema } from "@/lib/schemas";
import type { SuggestionType } from "@/types/session";

const requestSchema = z.object({
  apiKey: z.string().min(1),
  rollingSummary: z.string(),
  transcriptText: z.string().min(1),
  recentSuggestions: z.string(),
  basedOnChunkIds: z.array(z.string()),
  prompt: z.string().min(1),
});

const responseSchema = {
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
            enum: [
              "question_to_ask",
              "talking_point",
              "answer",
              "fact_check",
            ] as SuggestionType[],
          },
          preview: { type: "string" },
          detailedPromptSeed: { type: "string" },
          rationale: { type: "string" },
          confidence: {
            type: "string",
            enum: ["high", "medium", "low"],
          },
        },
        required: [
          "id",
          "type",
          "preview",
          "detailedPromptSeed",
          "rationale",
          "confidence",
        ],
      },
    },
  },
  required: ["id", "createdAt", "basedOnChunkIds", "suggestions"],
};

type SuggestionsCompletion = {
  choices: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

export async function POST(request: NextRequest) {
  const input = requestSchema.parse(await request.json());

  try {
    const groq = createGroqClient(input.apiKey);
    const completion = (await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      temperature: 0.2,
      messages: [
        { role: "system", content: input.prompt },
        {
          role: "user",
          content: [
            `ROLLING_SUMMARY:\n${input.rollingSummary || "None"}`,
            `RECENT_TRANSCRIPT:\n${input.transcriptText}`,
            `RECENT_SUGGESTION_BATCHES:\n${input.recentSuggestions || "None"}`,
            "Return exactly 3 suggestions.",
          ].join("\n\n"),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "suggestion_batch",
          strict: true,
          schema: responseSchema,
        },
      },
    })) as SuggestionsCompletion;

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json(
        { error: "Suggestion model returned an empty response" },
        { status: 500 },
      );
    }

    const payload = JSON.parse(content) as object;
    const batch = suggestionBatchSchema.parse({
      ...payload,
      id: (payload as { id?: string }).id || randomUUID(),
      createdAt:
        (payload as { createdAt?: string }).createdAt ||
        new Date().toISOString(),
      basedOnChunkIds:
        (payload as { basedOnChunkIds?: string[] }).basedOnChunkIds?.length
          ? (payload as { basedOnChunkIds: string[] }).basedOnChunkIds
          : input.basedOnChunkIds,
    });

    return NextResponse.json(batch);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Suggestion generation request failed",
      },
      { status: 500 },
    );
  }
}
