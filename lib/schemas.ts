import { z } from "zod";

export const suggestionSchema = z.object({
  id: z.string(),
  type: z.enum(["question_to_ask", "talking_point", "answer", "fact_check"]),
  preview: z.string().min(1),
  detailedPromptSeed: z.string().min(1),
  rationale: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
});

export const suggestionBatchSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  basedOnChunkIds: z.array(z.string()),
  suggestions: z.tuple([
    suggestionSchema,
    suggestionSchema,
    suggestionSchema,
  ]),
});

export const chatMessageInputSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
