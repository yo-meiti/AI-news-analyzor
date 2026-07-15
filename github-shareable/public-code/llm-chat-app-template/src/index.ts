import { ChatMessage, Env, PersonaState } from "./types";

const MODEL_ID = "@cf/openai/gpt-oss-120b";
const MAX_RECENT_TURNS = 4;
const MAX_PERSONA_MEMORIES = 8;

const DEFAULT_PERSONA: Omit<PersonaState, "updatedAt"> = {
  baseInstruction: "Always write in Persian with a friendly, creative, and practical analyst voice.",
  language: "fa",
  tone: "friendly",
  style: "concise",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChatRequest(request, env, ctx);
    }

    if (url.pathname === "/api/persona" && request.method === "GET") {
      return jsonResponse({ persona: DEFAULT_PERSONA, memories: [] }, 200);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleChatRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    await ensureDatabase(env.DB);
    const body = (await request.json()) as { messages?: ChatMessage[]; external_id?: string; news_title?: string };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const latestUserMessage = getLatestUserMessage(messages);

    if (!latestUserMessage) {
      return jsonResponse({ error: "A user message is required" }, 400);
    }

    const modelMessages: ChatMessage[] = [
      { role: "system", content: "SYSTEM PROMPT - public-safe analyzer export" },
      { role: "user", content: latestUserMessage },
    ];

    const aiStream = (await env.AI.run(MODEL_ID, {
      messages: modelMessages,
      max_tokens: 1200,
      stream: true,
    })) as ReadableStream<Uint8Array>;

    const [toClient, toDb] = aiStream.tee();
    ctx.waitUntil(persistAnalysisJob(env.DB, body.external_id ?? null, latestUserMessage, body.news_title ?? null, toDb));

    return new Response(toClient, {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
    });
  } catch (error) {
    console.error("Error processing chat request:", error);
    return jsonResponse({ error: "Failed to process request" }, 500);
  }
}

async function ensureDatabase(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS analysis_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, external_id TEXT UNIQUE, news_title TEXT, user_message TEXT NOT NULL, status TEXT NOT NULL, analysis_text TEXT, error_text TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS persona_state (id INTEGER PRIMARY KEY CHECK (id = 1), base_instruction TEXT NOT NULL, language TEXT NOT NULL, tone TEXT NOT NULL, style TEXT NOT NULL, updated_at TEXT NOT NULL);`).run();
  const row = await db.prepare("SELECT id FROM persona_state WHERE id = 1").first<{ id: number }>();
  if (!row) {
    await db.prepare(`INSERT INTO persona_state (id, base_instruction, language, tone, style, updated_at) VALUES (1, ?, ?, ?, ?, ?)`)
      .bind(DEFAULT_PERSONA.baseInstruction, DEFAULT_PERSONA.language, DEFAULT_PERSONA.tone, DEFAULT_PERSONA.style, new Date().toISOString())
      .run();
  }
}

async function persistAnalysisJob(db: D1Database, externalId: string | null, userMessage: string, newsTitle: string | null, stream: ReadableStream<Uint8Array>): Promise<void> {
  const text = await streamToText(stream);
  if (!externalId) return;

  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO analysis_jobs (external_id, news_title, user_message, status, analysis_text, error_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(external_id) DO UPDATE SET news_title = excluded.news_title, user_message = excluded.user_message, status = excluded.status, analysis_text = excluded.analysis_text, error_text = excluded.error_text, updated_at = excluded.updated_at`)
    .bind(externalId, newsTitle, userMessage, text || null, text ? "done" : "error", null, now, now)
    .run();
}

async function streamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result.trim();
}

function getLatestUserMessage(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index];
    if (msg.role === "user" && msg.content.trim()) {
      return msg.content.trim();
    }
  }
  return null;
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}