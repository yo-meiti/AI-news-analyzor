export interface Env {
  AI: Ai;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DB: D1Database;
}

export interface GeneratePromptRequest {
  input: string;
}

export interface PromptRecord {
  id: number;
  user_input: string;
  prompt_text: string;
  created_at: string;
}