/**
 * Image Prompt Generator Worker
 *
 * Accepts user input, generates an English image prompt, and stores every
 * generated prompt in D1.
 */
import { Env, GeneratePromptRequest, PromptRecord } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";
const MAX_INPUT_CHARS = 5000;
const MAX_PROMPT_CHARS = 500;

const SYSTEM_PROMPT = `You are a safety-first prompt engineer for text-to-image models.
Return exactly ONE final prompt in English only.
Do not include markdown, labels, explanations, lists, or multiple options.

Your output must be vivid and production-ready, covering:
subject details, scene/background, lighting, composition/camera, style, and quality descriptors.

HARD SAFETY RULES (must always be followed):
1) Never mention real company/brand/product/trademark names.
2) Never mention logos, wordmarks, exact headlines, article titles, UI screenshots, or copyrighted text.
3) Never mention real people, celebrities, politicians, or public personas.
4) Never mention copyrighted characters/franchises/IP names.
5) If user input contains any such references, replace them with generic alternatives
   (e.g., "a leading tech company", "an advanced AI system", "executive team", "global enterprise").
6) Keep the scene original, neutral, and commercially safe.

Output constraints:
- Single paragraph only.
- 90-220 words preferred.
- English only.`;

interface AiTextResponse {
	response?: string;
	result?: { response?: string };
	choices?: Array<{
		message?: { content?: string };
		delta?: { content?: string };
	}>;
}

interface InsertMeta {
	last_row_id?: number | string;
}

interface InsertResult {
	meta?: InsertMeta;
}

const BLOCKED_TERMS = [
	"google",
	"apple",
	"microsoft",
	"meta",
	"amazon",
	"tesla",
	"openai",
	"nvidia",
	"samsung",
	"tiktok",
	"youtube",
	"instagram",
	"facebook",
	"twitter",
	"x.com",
	"linkedin",
	"netflix",
	"disney",
	"coca-cola",
	"mcdonald",
	"logo",
	"wordmark",
	"headline",
	"title",
	"celebrity",
	"politician",
	"public figure",
	"copyright",
	"trademark",
];

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		if (url.pathname === "/api/prompts") {
			if (request.method === "POST") {
				return handleGeneratePromptRequest(request, env);
			}
			if (request.method === "GET") {
				return handleListPromptsRequest(env);
			}
			return jsonResponse({ error: "Method not allowed" }, 405);
		}

		return jsonResponse({ error: "Not found" }, 404);
	},
} satisfies ExportedHandler<Env>;

async function handleGeneratePromptRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		if (!env.DB) {
			return jsonResponse(
				{ error: "Database binding is not configured." },
				500,
			);
		}

		const body = (await request.json()) as GeneratePromptRequest;
		const rawInput = body?.input?.trim();

		if (!rawInput) {
			return jsonResponse({ error: "Input is required." }, 400);
		}

		// Always use at most MAX_INPUT_CHARS characters from user input for prompt generation.
		const userInput = rawInput.slice(0, MAX_INPUT_CHARS).trim();

		const aiResponse = (await env.AI.run(MODEL_ID, {
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{
					role: "user",
					content: `Create one safe English image prompt for this request:\n${userInput}`,
				},
			],
			max_tokens: 350,
			temperature: 0.45,
		})) as AiTextResponse;

		const rawPrompt = normalizePrompt(extractAiText(aiResponse));
		const sanitizedPrompt = sanitizeGeneratedPrompt(rawPrompt);
		const prompt = enforceMaxChars(sanitizedPrompt, MAX_PROMPT_CHARS);

		if (!prompt) {
			return jsonResponse(
				{ error: "Prompt generation failed. Please try again." },
				502,
			);
		}

		const insertResult = (await env.DB.prepare(
			"INSERT INTO prompts (user_input, prompt_text) VALUES (?1, ?2)",
		)
			.bind(userInput, prompt)
			.run()) as InsertResult;

		return jsonResponse(
			{
				id: toNumericId(insertResult.meta?.last_row_id),
				input: userInput,
				prompt,
			},
			200,
		);
	} catch (error) {
		console.error("Error generating prompt:", error);
		return jsonResponse({ error: "Failed to generate prompt." }, 500);
	}
}

async function handleListPromptsRequest(env: Env): Promise<Response> {
	try {
		if (!env.DB) {
			return jsonResponse(
				{ error: "Database binding is not configured." },
				500,
			);
		}

		const { results } = await env.DB.prepare(
			`SELECT id, user_input, prompt_text, created_at
				 FROM prompts
				 ORDER BY id DESC
				 LIMIT 100`,
		).all<PromptRecord>();

		return jsonResponse(
			{
				prompts: Array.isArray(results) ? results : [],
			},
			200,
		);
	} catch (error) {
		console.error("Error fetching prompts:", error);
		return jsonResponse({ error: "Failed to fetch prompts." }, 500);
	}
}

function extractAiText(payload: AiTextResponse): string {
	if (!payload || typeof payload !== "object") {
		return "";
	}
	if (typeof payload.response === "string") {
		return payload.response;
	}
	if (typeof payload.result?.response === "string") {
		return payload.result.response;
	}
	const firstChoice = payload.choices?.[0];
	if (typeof firstChoice?.message?.content === "string") {
		return firstChoice.message.content;
	}
	if (typeof firstChoice?.delta?.content === "string") {
		return firstChoice.delta.content;
	}
	return "";
}

function normalizePrompt(text: string): string {
	return text
		.replace(/^```[a-zA-Z]*\s*|\s*```$/g, "")
		.replace(/^(prompt|image prompt)\s*:\s*/i, "")
		.replace(/^["'`]+|["'`]+$/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function sanitizeGeneratedPrompt(text: string): string {
	let out = text;

	// Remove explicit quoted title/headline fragments.
	out = out
		.replace(/\b(title|headline)\s*["“][^"”]+["”]/gi, "")
		.replace(/\b(title|headline)\s*'[^']+'/gi, "")
		.replace(/\blogo\b/gi, "brand symbol")
		.replace(/\bwordmark\b/gi, "brand emblem");

	// Replace frequent brand/product references with safe generic wording.
	out = out.replace(
		/\b(Google|Apple|Microsoft|Meta|Amazon|Tesla|OpenAI|NVIDIA|Samsung|TikTok|YouTube|Instagram|Facebook|Twitter|X|LinkedIn|Netflix|Disney|Coca[- ]?Cola|McDonald'?s)\b/gi,
		"a leading tech company",
	);

	// Replace public-figure wording.
	out = out.replace(
		/\b(celebrity|politician|public figure|famous person|real person)\b/gi,
		"executive professional",
	);

	out = out.replace(/\s+/g, " ").trim();

	// Final fallback if risky terms remain.
	if (containsBlockedTerms(out)) {
		return "A high-resolution cinematic scene inside a modern enterprise strategy room where a diverse executive team reviews an advanced AI initiative on a large abstract digital display, with dynamic conversational body language, realistic textures, balanced composition, soft volumetric lighting, depth of field, and a professional editorial style suitable for commercial visual storytelling.";
	}

	return out;
}

function containsBlockedTerms(text: string): boolean {
	const lower = text.toLowerCase();
	return BLOCKED_TERMS.some((term) => lower.includes(term));
}

function toNumericId(value: number | string | undefined): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const numeric = Number(value);
		if (Number.isFinite(numeric)) {
			return numeric;
		}
	}
	return null;
}

function enforceMaxChars(text: string, maxChars: number): string {
	return text.slice(0, maxChars).trim();
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
		},
	});
}
