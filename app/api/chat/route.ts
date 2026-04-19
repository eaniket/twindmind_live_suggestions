import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type Groq from "groq-sdk";
import { createGroqClient } from "@/lib/groq";
import { chatMessageInputSchema } from "@/lib/schemas";

const requestSchema = z.object({
  apiKey: z.string().min(1),
  chatMessages: z.array(chatMessageInputSchema),
  transcriptText: z.string(),
  rollingSummary: z.string(),
  prompt: z.string().min(1),
  userMessage: z.string().min(1),
});

type ChatChunk = {
  choices: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
};

export async function POST(request: NextRequest) {
  const input = requestSchema.parse(await request.json());

  try {
    const groq = createGroqClient(input.apiKey);
    const stream = (await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      temperature: 0.3,
      stream: true,
      messages: [
        { role: "system", content: input.prompt },
        {
          role: "user",
          content: [
            `ROLLING_SUMMARY:\n${input.rollingSummary || "None"}`,
            `TRANSCRIPT_CONTEXT:\n${input.transcriptText || "None"}`,
            `USER_REQUEST:\n${input.userMessage}`,
          ].join("\n\n"),
        },
        ...input.chatMessages,
      ],
    })) as AsyncIterable<ChatChunk>;

    const encoder = new TextEncoder();

    return new NextResponse(
      new ReadableStream({
        async start(controller) {
          for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
              controller.enqueue(encoder.encode(token));
            }
          }
          controller.close();
        },
      }),
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Chat request failed",
      },
      { status: 500 },
    );
  }
}
