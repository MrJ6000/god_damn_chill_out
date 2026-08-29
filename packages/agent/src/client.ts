import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY?.trim();

export const isMockMode = !apiKey;
export const openAIModel = process.env.OPENAI_MODEL?.trim() || "gpt-4o";
export const openaiClient = apiKey ? new OpenAI({ apiKey }) : null;
