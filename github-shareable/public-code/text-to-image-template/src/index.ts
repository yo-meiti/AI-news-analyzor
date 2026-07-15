const MODEL = "@cf/black-forest-labs/flux-2-dev";
const DEFAULT_PROMPT = "cyberpunk alley in heavy rain, cinematic lighting";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(renderPage(DEFAULT_PROMPT), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (request.method === "POST" && url.pathname === "/api/generate-to-telegram") {
      const payload = await request.json().catch(() => null) as { prompt?: string; chatId?: string; caption?: string } | null;
      const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
      if (!prompt) return textResponse("prompt is required", 400);

      const chatId = payload?.chatId?.trim() || (env.TELEGRAM_DEFAULT_CHAT_ID || "").trim();
      if (!chatId) return textResponse("chatId is required (or set TELEGRAM_DEFAULT_CHAT_ID).", 400);

      try {
        const imageBytes = await generateImage(env, prompt);
        const messageId = await sendImageToTelegram(env, chatId, imageBytes, payload?.caption || `Prompt: ${prompt.slice(0, 180)}`);
        return jsonResponse({ ok: true, chatId, messageId }, 200);
      } catch (error) {
        console.error("Send to Telegram failed:", error);
        return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "Failed to send image to Telegram." }, 500);
      }
    }

    return textResponse("Not found", 404);
  },
} satisfies ExportedHandler<Env>;

async function generateImage(env: Env, prompt: string): Promise<Uint8Array> {
  const raw = await env.AI.run(MODEL, { prompt });
  return toBytes(raw);
}

async function sendImageToTelegram(env: Env, chatId: string, imageBytes: Uint8Array, caption: string): Promise<number | undefined> {
  const token = (env as Env & { TELEGRAM_BOT_TOKEN?: string }).TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption.slice(0, 1024));
  form.append("photo", new Blob([imageBytes], { type: "image/png" }), "generated.png");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Telegram sendPhoto failed with status ${response.status}`);

  const data = await response.json().catch(() => ({})) as { result?: { message_id?: number } };
  return data.result?.message_id;
}

function renderPage(prompt: string): string {
  return `<!doctype html><html><body><pre>${escapeHtml(prompt)}</pre></body></html>`;
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error("Unsupported image output.");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}