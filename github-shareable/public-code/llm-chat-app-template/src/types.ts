export interface Env {
  AI: Ai;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DB: D1Database;
  TAVILY_API_KEY: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PersonaState {
  baseInstruction: string;
  language: "fa" | "en";
  tone: "friendly" | "formal";
  style: "concise" | "detailed";
  updatedAt: string;
}