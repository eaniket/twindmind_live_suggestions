import Groq from "groq-sdk";

export function createGroqClient(apiKey: string) {
  return new Groq({ apiKey });
}
