import { Env, GeneratePromptRequest, PromptRecord } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/prompts") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method === "POST") {
      return handleGeneratePromptRequest(request, env);
    }

    if (request.method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT id, user_input, prompt_text, created_at FROM prompts ORDER BY id DESC LIMIT 100`,
      ).all<PromptRecord>();
      return jsonResponse({ prompts: Array.isArray(results) ? results : [] }, 200);
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  },
} satisfies ExportedHandler<Env>;

async function handleGeneratePromptRequest(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as GeneratePromptRequest;
    const input = body?.input?.trim();
    if (!input) return jsonResponse({ error: "Input is required." }, 400);

    const aiResponse = (await env.AI.run(MODEL_ID, {
      messages: [
        { role: "system", content: "Return exactly one safe English image prompt." },
        { role: "user", content: `Create one safe English image prompt for this request:\n${input.slice(0, 5000)}` },
      ],
      max_tokens: 350,
      temperature: 0.45,
    })) as { response?: string; result?: { response?: string } };

    const prompt = normalizePrompt(aiResponse.response ?? aiResponse.result?.response ?? "");
    if (!prompt) return jsonResponse({ error: "Prompt generation failed. Please try again." }, 502);

    await env.DB.prepare("INSERT INTO prompts (user_input, prompt_text) VALUES (?1, ?2)")
      .bind(input.slice(0, 5000), prompt.slice(0, 500))
      .run();

    return jsonResponse({ input, prompt }, 200);
  } catch (error) {
    console.error("Error generating prompt:", error);
    return jsonResponse({ error: "Failed to generate prompt." }, 500);
  }
}

function normalizePrompt(text: string): string {
  return text.replace(/^```[a-zA-Z]*\s*|\s*```$/g, "").replace(/\s+/g, " ").trim();
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}