/**
 * LLM Chat Application Template
 *
 * A chat application using Cloudflare Workers AI with persistent model persona memory in D1.
 *
 * @license MIT
 */
import { ChatMessage, Env, PersonaState } from "./types";

const MODEL_ID = "@cf/openai/gpt-oss-120b";

const SYSTEM_PROMPT = `SYSTEM PROMPT - Telegram AI Opportunity Analyst v5

تو نویسنده و تحلیلگر یک کانال تلگرام درباره AI و کسب درآمد با AI هستی.
خروجی باید کوتاه، جذاب، دوستانه، خلاقانه و در عین حال دقیق باشد.

قواعد لحن:
- فارسی روان و انسانی بنویس؛ لحن رباتی ممنوع.
- از جمله های کوتاه و متوسط به صورت ترکیبی استفاده کن.
- حداکثر 2 ایموجی.
- اغراق رسانه ای، شعار و کلی گویی ممنوع.

قواعد دقت:
- فقط بر اساس WEB_SEARCH_CONTEXT بنویس.
- منبع، عدد یا ادعای بدون شاهد نساز.
- اگر داده کافی نیست، صریح بگو «نامطمئن» یا «Noise».

ساختار خروجی (کم حجم و اجباری):
1) هوک
یک جمله قلابی و جذاب.

2) اصل خبر
1 تا 2 جمله، فقط تغییر واقعی.

3) تحلیل خلاقانه
حداکثر 3 بولت کوتاه:
- مکانیزم اثر
- اثر مرتبه دوم (second-order)
- برنده/بازنده احتمالی

4) فرصت و ریسک واقعی
- فرصت درآمدی/محصولی: حداکثر 2 بولت عملی
- ریسک/هزینه پنهان: حداکثر 2 بولت واقعی

5) آینده نزدیک (3 ماه)
سه سناریو با احتمال:
- سناریوی صعودی: xx%
- سناریوی پایه: xx%
- سناریوی نزولی: xx%
برای هر سناریو یک محرک کلیدی بنویس.

6) اقدام عملی
سه خط کوتاه:
- 24 ساعت آینده
- 7 روز آینده
- 30 روز آینده

7) منابع
در انتها تیتر «منابع» را بیاور.
فقط URLهای WEB_SEARCH_CONTEXT.
حداقل 2 و حداکثر 3 منبع.

یادگیری درجا (اجباری):
- یک خط: «چیزی که این تحلیل می توانست بهتر انجام دهد: ...»
- سپس نسخه کمی بهتر و فشرده تر را در حداکثر 4 خط بازنویسی کن.

در انتهای پاسخ، این بلوک عددی را دقیقا بیاور:
Strategic Depth: <0..10>
Practical Decision Value: <0..10>
Intellectual Honesty: <0..10>
Average: <0..10>
ARCHIVE_WORTHY = <TRUE|FALSE>

قانون:
- اگر Average >= 8 => ARCHIVE_WORTHY = TRUE
- اگر Average < 8 => ARCHIVE_WORTHY = FALSE`;

const DEFAULT_PERSONA: Omit<PersonaState, "updatedAt"> = {
	baseInstruction:
		"Always write in Persian with a friendly, creative, and practical analyst voice. Prioritize clarity, evidence, and actionable decisions.",
	language: "fa",
	tone: "friendly",
	style: "concise",
};

const MAX_RECENT_TURNS = 4;
const MAX_PERSONA_MEMORIES = 8;
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MAX_WEB_RESULTS = 3;
const SEARCH_QUERY_MODEL_MAX_TOKENS = 80;
const ANALYSIS_MODEL_MAX_TOKENS = 1800;
const MAX_ARCHIVE_STYLE_SAMPLES = 2;
const JOB_PROGRESS_SAVE_EVERY_CHARS = 500;
type AnalysisJobStatus = "pending" | "processing" | "done" | "error";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				return handleChatRequest(request, env, ctx);
			}
			return methodNotAllowed();
		}

		if (url.pathname === "/api/persona") {
			if (request.method === "GET") {
				return handleGetPersona(env);
			}
			if (request.method === "PUT") {
				return handleUpdatePersona(request, env);
			}
			return methodNotAllowed();
		}

		if (url.pathname === "/api/persona/memories") {
			if (request.method === "POST") {
				return handleAddPersonaMemory(request, env);
			}
			return methodNotAllowed();
		}

		if (url.pathname === "/api/persona/reset") {
			if (request.method === "POST") {
				return handleResetPersona(env);
			}
			return methodNotAllowed();
		}

		if (url.pathname === "/api/archive-samples") {
			if (request.method === "GET") {
				return handleGetArchiveSamples(env);
			}
			return methodNotAllowed();
		}

		if (url.pathname === "/api/jobs") {
			if (request.method === "GET") {
				return handleGetAnalysisJob(env, url.searchParams.get("external_id"));
			}
			return methodNotAllowed();
		}

		if (url.pathname === "/api/jobs/latest") {
			if (request.method === "GET") {
				return handleGetLatestAnalysisJob(env);
			}
			return methodNotAllowed();
		}

		if (url.pathname.startsWith("/api/jobs/")) {
			const externalId = decodeURIComponent(url.pathname.slice("/api/jobs/".length));
			if (request.method === "GET") {
				return handleGetAnalysisJob(env, externalId);
			}
			if (request.method === "PUT" || request.method === "PATCH") {
				return handleUpdateAnalysisJob(request, env, externalId);
			}
			return methodNotAllowed();
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

async function handleChatRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	let externalId: string | null = null;
	let latestUserMessage: string | null = null;

	try {
		await ensureDatabase(env.DB);

		const body = (await request.json()) as {
			messages?: ChatMessage[];
			external_id?: string;
			externalId?: string;
			news_title?: string;
			newsTitle?: string;
			title?: string;
		};
		const messages = Array.isArray(body.messages) ? body.messages : [];
		latestUserMessage = getLatestUserMessage(messages);
		const rawExternalId =
			typeof body.external_id === "string"
				? body.external_id
				: typeof body.externalId === "string"
					? body.externalId
					: null;
		const rawNewsTitle =
			typeof body.news_title === "string"
				? body.news_title
				: typeof body.newsTitle === "string"
					? body.newsTitle
					: typeof body.title === "string"
						? body.title
						: null;
		const newsTitle = sanitizeNewsTitle(rawNewsTitle);
		externalId = rawExternalId === null ? null : sanitizeExternalId(rawExternalId);
		if (rawExternalId !== null && !externalId) {
			return jsonResponse(
				{
					error:
						"external_id is invalid. Use 3..80 chars with letters, numbers, underscore, hyphen, colon, or dot.",
				},
				400,
			);
		}

		if (!latestUserMessage) {
			return jsonResponse({ error: "A user message is required" }, 400);
		}

		if (externalId) {
			await upsertAnalysisJob({
				db: env.DB,
				externalId,
				userMessage: latestUserMessage,
				status: "processing",
				newsTitle,
				analysisText: null,
				errorText: null,
			});
		}

		const webQuery = await synthesizeWebSearchQuery(latestUserMessage, env);

		let webSearchContext: WebSearchContext | null = null;
		let webSearchMessage: ChatMessage | null = null;
		try {
			webSearchContext = await fetchOptionalWebSearchContext(
				latestUserMessage,
				webQuery,
				env,
			);
			if (webSearchContext) {
				webSearchMessage = {
					role: "system",
					content: buildWebSearchPrompt(webSearchContext),
				};
			} else {
				webSearchMessage = {
					role: "system",
					content: buildSearchlessPrompt(latestUserMessage, webQuery),
				};
			}
		} catch (error) {
			console.error("Web search fallback failed:", error);
			webSearchMessage = {
				role: "system",
				content: buildSearchlessPrompt(latestUserMessage, webQuery),
			};
		}

			const persona = await getPersona(env.DB);
			const memories = await getTopMemories(env.DB, MAX_PERSONA_MEMORIES);
			const recentTurns = await getRecentTurns(env.DB, MAX_RECENT_TURNS);
			const archiveSamples = await getTopArchiveSamples(env.DB, MAX_ARCHIVE_STYLE_SAMPLES);
			const archiveStylePrompt = buildArchiveStylePrompt(archiveSamples);

			const modelMessages: ChatMessage[] = [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "system", content: buildPersonaPrompt(persona, memories) },
				...(webSearchMessage ? [webSearchMessage] : []),
				...(archiveStylePrompt
					? ([{ role: "system", content: archiveStylePrompt }] as ChatMessage[])
					: []),
				...recentTurns,
				{ role: "user", content: latestUserMessage },
			];

		const aiStream = (await env.AI.run(
			MODEL_ID,
			{
				messages: modelMessages,
				max_tokens: ANALYSIS_MODEL_MAX_TOKENS,
				stream: true,
			},
			{},
		)) as ReadableStream<Uint8Array>;

		const [toClient, toDb] = aiStream.tee();

		ctx.waitUntil(
			persistTurnAndMemory({
				db: env.DB,
				ai: env.AI,
				userMessage: latestUserMessage,
				newsTitle,
				externalId,
				assistantStream: toDb,
				currentPersona: persona,
			}),
		);

		return new Response(toClient, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		if (externalId && latestUserMessage) {
			await upsertAnalysisJob({
				db: env.DB,
				externalId,
				userMessage: latestUserMessage,
				status: "error",
				newsTitle: null,
				analysisText: null,
				errorText: `Request failed: ${toErrorMessage(error)}`,
			});
		}
		return jsonResponse({ error: "Failed to process request" }, 500);
	}
}


async function handleGetPersona(env: Env): Promise<Response> {
	try {
		await ensureDatabase(env.DB);
		const persona = await getPersona(env.DB);
		const memories = await getTopMemories(env.DB, 50);
		return jsonResponse({ persona, memories }, 200);
	} catch (error) {
		console.error("Error getting persona:", error);
		return jsonResponse({ error: "Failed to load persona" }, 500);
	}
}

async function handleUpdatePersona(request: Request, env: Env): Promise<Response> {
	try {
		await ensureDatabase(env.DB);
		const body = (await request.json()) as Partial<
			Pick<PersonaState, "baseInstruction" | "language" | "tone" | "style">
		>;

		const current = await getPersona(env.DB);
		const next: Omit<PersonaState, "updatedAt"> = {
			baseInstruction:
				typeof body.baseInstruction === "string" && body.baseInstruction.trim().length > 0
					? body.baseInstruction.trim()
					: current.baseInstruction,
			language:
				body.language === "fa" || body.language === "en"
					? body.language
					: current.language,
			tone:
				body.tone === "friendly" || body.tone === "formal"
					? body.tone
					: current.tone,
			style:
				body.style === "concise" || body.style === "detailed"
					? body.style
					: current.style,
		};

		await upsertPersona(env.DB, next);
		const updated = await getPersona(env.DB);
		return jsonResponse({ persona: updated }, 200);
	} catch (error) {
		console.error("Error updating persona:", error);
		return jsonResponse({ error: "Failed to update persona" }, 500);
	}
}

async function handleResetPersona(env: Env): Promise<Response> {
	try {
		await ensureDatabase(env.DB);
		await env.DB.prepare("DELETE FROM persona_memories;").run();
		await env.DB.prepare("DELETE FROM conversation_turns;").run();
		await env.DB.prepare("DELETE FROM analysis_reference_samples;").run();
		await env.DB.prepare("DELETE FROM analysis_jobs;").run();
		await upsertPersona(env.DB, DEFAULT_PERSONA);
		const persona = await getPersona(env.DB);
		return jsonResponse({ ok: true, persona }, 200);
	} catch (error) {
		console.error("Error resetting persona:", error);
		return jsonResponse({ error: "Failed to reset persona" }, 500);
	}
}

async function handleGetArchiveSamples(env: Env): Promise<Response> {
	try {
		await ensureDatabase(env.DB);
		const rows = await env.DB
			.prepare(
				`SELECT id, news_input, analysis_text, strategic_depth, practical_decision_value,
						intellectual_honesty, average_score, created_at
				 FROM analysis_reference_samples
				 WHERE archive_worthy = 1
				 ORDER BY average_score DESC, id DESC
				 LIMIT 100`,
			)
			.all<{
				id: number;
				news_input: string;
				analysis_text: string;
				strategic_depth: number | null;
				practical_decision_value: number | null;
				intellectual_honesty: number | null;
				average_score: number | null;
				created_at: string;
			}>();

		return jsonResponse({ samples: rows.results || [] }, 200);
	} catch (error) {
		console.error("Error reading archive samples:", error);
		return jsonResponse({ error: "Failed to load archive samples" }, 500);
	}
}

async function handleGetAnalysisJob(
	env: Env,
	rawExternalId: string | null,
): Promise<Response> {
	try {
		await ensureDatabase(env.DB);
		if (!rawExternalId) {
			return jsonResponse({ error: "external_id is required" }, 400);
		}
		const externalId = sanitizeExternalId(rawExternalId);
		if (!externalId) {
			return jsonResponse({ error: "external_id is invalid" }, 400);
		}

		const job = await getAnalysisJobByExternalId(env.DB, externalId);
		if (!job) {
			return jsonResponse({ error: "Job not found" }, 404);
		}

		return jsonResponse({ job }, 200);
	} catch (error) {
		console.error("Error reading analysis job:", error);
		return jsonResponse({ error: "Failed to load analysis job" }, 500);
	}
}

async function handleGetLatestAnalysisJob(env: Env): Promise<Response> {
	try {
		await ensureDatabase(env.DB);
		const job = await getLatestAnalysisJob(env.DB);
		if (!job) {
			return jsonResponse({ error: "No jobs found" }, 404);
		}
		return jsonResponse({ job }, 200);
	} catch (error) {
		console.error("Error reading latest analysis job:", error);
		return jsonResponse({ error: "Failed to load latest analysis job" }, 500);
	}
}

async function handleUpdateAnalysisJob(
	request: Request,
	env: Env,
	rawExternalId: string,
): Promise<Response> {
	try {
		await ensureDatabase(env.DB);
		const externalId = sanitizeExternalId(rawExternalId);
		if (!externalId) {
			return jsonResponse({ error: "external_id is invalid" }, 400);
		}

		const current = await getAnalysisJobByExternalId(env.DB, externalId);
		if (!current) {
			return jsonResponse({ error: "Job not found" }, 404);
		}

		const body = (await request.json()) as {
			analysis_text?: string;
			analysisText?: string;
			news_title?: string;
			newsTitle?: string;
			title?: string;
		};
		const nextAnalysisRaw =
			typeof body.analysis_text === "string"
				? body.analysis_text
				: typeof body.analysisText === "string"
					? body.analysisText
					: undefined;
		const nextTitleRaw =
			typeof body.news_title === "string"
				? body.news_title
				: typeof body.newsTitle === "string"
					? body.newsTitle
					: typeof body.title === "string"
						? body.title
						: undefined;

		if (nextAnalysisRaw === undefined && nextTitleRaw === undefined) {
			return jsonResponse(
				{
					error:
						"Provide at least one field: analysis_text (or analysisText), news_title (or newsTitle/title).",
				},
				400,
			);
		}

		const nextAnalysis =
			typeof nextAnalysisRaw === "string"
				? nextAnalysisRaw.replace(/\r\n/g, "\n").trim()
				: current.analysisText;
		const nextTitle =
			typeof nextTitleRaw === "string"
				? sanitizeNewsTitle(nextTitleRaw)
				: current.newsTitle;
		const nextStatus: AnalysisJobStatus =
			typeof nextAnalysisRaw === "string" ? "done" : current.status;

		await upsertAnalysisJob({
			db: env.DB,
			externalId,
			userMessage: current.userMessage,
			status: nextStatus,
			newsTitle: nextTitle,
			analysisText: nextAnalysis,
			errorText: null,
		});

		const updated = await getAnalysisJobByExternalId(env.DB, externalId);
		return jsonResponse({ ok: true, job: updated }, 200);
	} catch (error) {
		console.error("Error updating analysis job:", error);
		return jsonResponse({ error: "Failed to update analysis job" }, 500);
	}
}

async function handleAddPersonaMemory(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		await ensureDatabase(env.DB);
		const body = (await request.json()) as { text?: string; weight?: number };
		const text = typeof body.text === "string" ? sanitizeMemoryText(body.text) : "";
		if (text.length < 3) {
			return jsonResponse({ error: "memory text is required" }, 400);
		}

		const weight =
			typeof body.weight === "number" && Number.isFinite(body.weight)
				? Math.min(10, Math.max(0.1, body.weight))
				: 1;

		await env.DB
			.prepare(
				"INSERT INTO persona_memories (memory_text, weight, created_at) VALUES (?, ?, ?)",
			)
			.bind(text, weight, new Date().toISOString())
			.run();

		const memories = await getTopMemories(env.DB, 50);
		return jsonResponse({ ok: true, memories }, 200);
	} catch (error) {
		console.error("Error adding persona memory:", error);
		return jsonResponse({ error: "Failed to add memory" }, 500);
	}
}

async function ensureDatabase(db: D1Database): Promise<void> {
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS persona_state (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				base_instruction TEXT NOT NULL,
				language TEXT NOT NULL CHECK (language IN ('fa', 'en')),
				tone TEXT NOT NULL CHECK (tone IN ('friendly', 'formal')),
				style TEXT NOT NULL CHECK (style IN ('concise', 'detailed')),
				updated_at TEXT NOT NULL
			);`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS persona_memories (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				memory_text TEXT NOT NULL,
				weight REAL NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL
			);`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS conversation_turns (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
				content TEXT NOT NULL,
				created_at TEXT NOT NULL
			);`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS analysis_reference_samples (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				news_input TEXT NOT NULL,
				analysis_text TEXT NOT NULL,
				strategic_depth REAL,
				practical_decision_value REAL,
				intellectual_honesty REAL,
				average_score REAL,
				archive_worthy INTEGER NOT NULL CHECK (archive_worthy IN (0, 1)),
				created_at TEXT NOT NULL
			);`,
		)
		.run();

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS analysis_jobs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				external_id TEXT NOT NULL UNIQUE,
				news_title TEXT,
				user_message TEXT NOT NULL,
				status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'error')),
				analysis_text TEXT,
				error_text TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);`,
		)
		.run();

	await ensureTableColumn(db, "analysis_jobs", "news_title", "TEXT");

	const row = await db
		.prepare("SELECT id FROM persona_state WHERE id = 1")
		.first<{ id: number }>();
	if (!row) {
		await upsertPersona(db, DEFAULT_PERSONA);
	}
}

async function ensureTableColumn(
	db: D1Database,
	tableName: string,
	columnName: string,
	columnSqlType: string,
): Promise<void> {
	const pragma = await db
		.prepare(`PRAGMA table_info(${tableName});`)
		.all<{ name: string }>();
	const columns = pragma.results || [];
	const exists = columns.some((column) => column.name === columnName);
	if (!exists) {
		await db
			.prepare(
				`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSqlType};`,
			)
			.run();
	}
}

async function getPersona(db: D1Database): Promise<PersonaState> {
	const row = await db
		.prepare(
			"SELECT base_instruction, language, tone, style, updated_at FROM persona_state WHERE id = 1",
		)
		.first<{
			base_instruction: string;
			language: "fa" | "en";
			tone: "friendly" | "formal";
			style: "concise" | "detailed";
			updated_at: string;
		}>();

	if (!row) {
		return {
			...DEFAULT_PERSONA,
			updatedAt: new Date().toISOString(),
		};
	}

	return {
		baseInstruction: row.base_instruction,
		language: row.language,
		tone: row.tone,
		style: row.style,
		updatedAt: row.updated_at,
	};
}

async function upsertPersona(
	db: D1Database,
	persona: Omit<PersonaState, "updatedAt">,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO persona_state (id, base_instruction, language, tone, style, updated_at)
			 VALUES (1, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			 base_instruction = excluded.base_instruction,
			 language = excluded.language,
			 tone = excluded.tone,
			 style = excluded.style,
			 updated_at = excluded.updated_at`,
		)
		.bind(
			persona.baseInstruction,
			persona.language,
			persona.tone,
			persona.style,
			new Date().toISOString(),
		)
		.run();
}

async function getTopMemories(
	db: D1Database,
	limit: number,
): Promise<Array<{ id: number; memoryText: string; weight: number }>> {
	const rows = await db
		.prepare(
			`SELECT id, memory_text, weight
			 FROM persona_memories
			 ORDER BY weight DESC, id DESC
			 LIMIT ?`,
		)
		.bind(limit)
		.all<{ id: number; memory_text: string; weight: number }>();

	return (rows.results || []).map((row) => ({
		id: row.id,
		memoryText: row.memory_text,
		weight: row.weight,
	}));
}

async function getRecentTurns(db: D1Database, limit: number): Promise<ChatMessage[]> {
	const rows = await db
		.prepare(
			`SELECT role, content
			 FROM conversation_turns
			 ORDER BY id DESC
			 LIMIT ?`,
		)
		.bind(limit)
		.all<{ role: "user" | "assistant"; content: string }>();

	return (rows.results || [])
		.reverse()
		.map((row) => ({ role: row.role, content: row.content }));
}

async function getTopArchiveSamples(
	db: D1Database,
	limit: number,
): Promise<Array<{ analysisText: string; averageScore: number | null }>> {
	const rows = await db
		.prepare(
			`SELECT analysis_text, average_score
			 FROM analysis_reference_samples
			 WHERE archive_worthy = 1
			 ORDER BY average_score DESC, id DESC
			 LIMIT ?`,
		)
		.bind(limit)
		.all<{ analysis_text: string; average_score: number | null }>();

	return (rows.results || []).map((row) => ({
		analysisText: row.analysis_text,
		averageScore:
			typeof row.average_score === "number" && Number.isFinite(row.average_score)
				? row.average_score
				: null,
	}));
}

function buildArchiveStylePrompt(
	samples: Array<{ analysisText: string; averageScore: number | null }>,
): string | null {
	if (samples.length === 0) {
		return null;
	}

	const sampleLines = samples
		.map((sample, index) => {
			const scoreText =
				sample.averageScore === null ? "n/a" : sample.averageScore.toFixed(2);
			return [
				`Sample ${index + 1} (score ${scoreText})`,
				compactPromptSnippet(sample.analysisText, 700),
			].join("\n");
		})
		.join("\n\n");

	return [
		"STYLE_LEARNING_CONTEXT (FROM BEST PAST POSTS)",
		"Use these as writing-style examples only. Do not copy their facts or claims.",
		"Borrow strengths: clarity, hook quality, practical actions, and non-robotic rhythm.",
		sampleLines,
	].join("\n");
}

function compactPromptSnippet(text: string, maxChars: number): string {
	return text.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function buildPersonaPrompt(
	persona: PersonaState,
	memories: Array<{ id: number; memoryText: string; weight: number }>,
): string {
	const memoryLines =
		memories.length > 0
			? memories.map((m, idx) => `${idx + 1}. ${m.memoryText}`).join("\n")
			: "No long-term memories stored yet.";

	return [
		"Persistent persona memory:",
		`- Base instruction: ${persona.baseInstruction}`,
		`- Language: ${persona.language === "fa" ? "Persian" : "English"}`,
		`- Tone: ${persona.tone}`,
		`- Style: ${persona.style}`,
		"- Long-term memories:",
		memoryLines,
	].join("\n");
}

function getLatestUserMessage(messages: ChatMessage[]): string | null {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const msg = messages[i];
		if (msg.role === "user") {
			const text = msg.content.trim();
			if (text.length > 0) {
				return text;
			}
		}
	}
	return null;
}

async function persistTurnAndMemory(input: {
	db: D1Database;
	ai: Ai;
	userMessage: string;
	newsTitle: string | null;
	externalId: string | null;
	assistantStream: ReadableStream<Uint8Array>;
	currentPersona: PersonaState;
}): Promise<void> {
	let jobFinalized = false;
	let assistantReply = "";
	let latestPartialReply = "";
	const trackedExternalId = input.externalId;
	try {
		const progressUpdater = trackedExternalId
			? async (currentText: string): Promise<void> => {
					latestPartialReply = currentText;
					await upsertAnalysisJob({
						db: input.db,
						externalId: trackedExternalId,
						userMessage: input.userMessage,
						status: "processing",
						newsTitle: input.newsTitle,
						analysisText: currentText,
						errorText: null,
					});
				}
			: undefined;

		const streamResult = await readAssistantTextFromSse(
			input.assistantStream,
			progressUpdater,
		);
		assistantReply = streamResult.text;
		latestPartialReply = assistantReply;
		if (trackedExternalId) {
			if (assistantReply.trim().length > 0) {
				await upsertAnalysisJob({
					db: input.db,
					externalId: trackedExternalId,
					userMessage: input.userMessage,
					status: streamResult.completed ? "done" : "error",
					newsTitle: input.newsTitle,
					analysisText: assistantReply,
					errorText: streamResult.completed
						? null
						: "Stream ended before completion marker ([DONE]).",
				});
			} else {
				await upsertAnalysisJob({
					db: input.db,
					externalId: trackedExternalId,
					userMessage: input.userMessage,
					status: "error",
					newsTitle: input.newsTitle,
					analysisText: null,
					errorText: "Assistant stream ended with empty output.",
				});
			}
			jobFinalized = true;
		}

		await input.db
			.prepare("INSERT INTO conversation_turns (role, content, created_at) VALUES (?, ?, ?)")
			.bind("user", input.userMessage, new Date().toISOString())
			.run();

		if (assistantReply.length > 0) {
			await input.db
				.prepare("INSERT INTO conversation_turns (role, content, created_at) VALUES (?, ?, ?)")
				.bind("assistant", assistantReply, new Date().toISOString())
				.run();
		}

		await input.db
			.prepare(
				`DELETE FROM conversation_turns
				 WHERE id NOT IN (
					SELECT id FROM conversation_turns ORDER BY id DESC LIMIT 200
				 );`,
			)
			.run();

		await storeArchiveWorthyAnalysis({
			db: input.db,
			ai: input.ai,
			userMessage: input.userMessage,
			assistantReply,
		});

		const extracted = extractMemoryFromUserMessage(input.userMessage);
		if (extracted) {
			await input.db
				.prepare(
					"INSERT INTO persona_memories (memory_text, weight, created_at) VALUES (?, ?, ?)",
				)
				.bind(extracted, 1, new Date().toISOString())
				.run();

			await input.db
				.prepare(
					`DELETE FROM persona_memories
					 WHERE id NOT IN (
						SELECT id FROM persona_memories ORDER BY weight DESC, id DESC LIMIT 100
					 );`,
				)
				.run();
		}

		const personaPatch = inferPersonaPatch(input.userMessage);
		if (personaPatch) {
			await upsertPersona(input.db, {
				baseInstruction: input.currentPersona.baseInstruction,
				language: personaPatch.language ?? input.currentPersona.language,
				tone: personaPatch.tone ?? input.currentPersona.tone,
				style: personaPatch.style ?? input.currentPersona.style,
			});
		}
	} catch (error) {
		if (trackedExternalId && !jobFinalized) {
			const partialText =
				assistantReply.trim().length > 0
					? assistantReply
					: latestPartialReply.trim().length > 0
						? latestPartialReply
						: null;
			await upsertAnalysisJob({
				db: input.db,
				externalId: trackedExternalId,
				userMessage: input.userMessage,
				status: "error",
				newsTitle: input.newsTitle,
				analysisText: partialText,
				errorText: toErrorMessage(error),
			});
		}
		throw error;
	}
}

async function readAssistantTextFromSse(
	stream: ReadableStream<Uint8Array>,
	onProgress?: (currentText: string) => Promise<void>,
): Promise<{ text: string; completed: boolean }> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let text = "";
	let completed = false;
	let lastSavedLength = 0;

	const maybeSaveProgress = async (force: boolean): Promise<void> => {
		if (!onProgress) {
			return;
		}
		const shouldSave =
			force || text.length - lastSavedLength >= JOB_PROGRESS_SAVE_EVERY_CHARS;
		if (!shouldSave) {
			return;
		}
		lastSavedLength = text.length;
		await onProgress(text);
	};

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			if (buffer.length > 0) {
				text += extractTextFromSseEvents(buffer + "\n\n");
			}
			await maybeSaveProgress(true);
			break;
		}
		buffer += decoder.decode(value, { stream: true });
		const parsed = consumeSseEvents(buffer);
		buffer = parsed.buffer;
		for (const data of parsed.events) {
			if (data === "[DONE]") {
				completed = true;
				await maybeSaveProgress(true);
				return { text, completed };
			}
			const delta = extractDeltaText(data);
			if (delta.length > 0) {
				text += delta;
				await maybeSaveProgress(false);
			}
		}
	}

	return { text, completed };
}

function extractTextFromSseEvents(rawBuffer: string): string {
	const parsed = consumeSseEvents(rawBuffer);
	let text = "";
	for (const data of parsed.events) {
		if (data === "[DONE]") {
			break;
		}
		text += extractDeltaText(data);
	}
	return text;
}

function extractDeltaText(data: string): string {
	try {
		const json = JSON.parse(data) as {
			response?: string;
			choices?: Array<{
				delta?: {
					content?: string;
				};
			}>;
		};
		if (typeof json.response === "string") {
			return json.response;
		}
		return json.choices?.[0]?.delta?.content ?? "";
	} catch {
		return "";
	}
}

function consumeSseEvents(buffer: string): { events: string[]; buffer: string } {
	let normalized = buffer.replace(/\r/g, "");
	const events: string[] = [];
	let eventEndIndex: number;
	while ((eventEndIndex = normalized.indexOf("\n\n")) !== -1) {
		const rawEvent = normalized.slice(0, eventEndIndex);
		normalized = normalized.slice(eventEndIndex + 2);

		const lines = rawEvent.split("\n");
		const dataLines: string[] = [];
		for (const line of lines) {
			if (line.startsWith("data:")) {
				dataLines.push(line.slice("data:".length).trimStart());
			}
		}
		if (dataLines.length > 0) {
			events.push(dataLines.join("\n"));
		}
	}

	return { events, buffer: normalized };
}

function inferPersonaPatch(
	userMessage: string,
):
	| {
			language?: "fa" | "en";
			tone?: "friendly" | "formal";
			style?: "concise" | "detailed";
	  }
	| null {
	const text = userMessage.toLowerCase();
	const patch: {
		language?: "fa" | "en";
		tone?: "friendly" | "formal";
		style?: "concise" | "detailed";
	} = {};

	if (/[\u0600-\u06FF]/.test(userMessage)) {
		patch.language = "fa";
	} else if (/[a-z]/.test(text)) {
		patch.language = "en";
	}

	if (/(formal|رسمی)/i.test(userMessage)) {
		patch.tone = "formal";
	}
	if (/(friendly|casual|خودمونی|دوستانه)/i.test(userMessage)) {
		patch.tone = "friendly";
	}

	if (/(brief|short|concise|مختصر|خلاصه|کوتاه)/i.test(userMessage)) {
		patch.style = "concise";
	}
	if (/(detailed|deep|step by step|مفصل|جزئیات|کامل)/i.test(userMessage)) {
		patch.style = "detailed";
	}

	if (!patch.language && !patch.tone && !patch.style) {
		return null;
	}
	return patch;
}

function extractMemoryFromUserMessage(userMessage: string): string | null {
	const text = userMessage.trim();
	if (text.length < 8) {
		return null;
	}

	if (/\b(remember|remember that|note that)\b/i.test(text)) {
		return sanitizeMemoryText(text);
	}
	if (/(یادت باشه|به خاطر بسپار|یادداشت کن)/.test(text)) {
		return sanitizeMemoryText(text);
	}

	const nameMatch = text.match(/(?:my name is|اسم من|اسمم)\s+([^\n,.!؟?]{2,50})/i);
	if (nameMatch?.[1]) {
		return sanitizeMemoryText(`User name: ${nameMatch[1].trim()}`);
	}

	return null;
}

function sanitizeMemoryText(input: string): string {
	return input.replace(/\s+/g, " ").trim().slice(0, 300);
}

function methodNotAllowed(): Response {
	return new Response("Method not allowed", { status: 405 });
}

function jsonResponse(data: unknown, status: number): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json" },
	});
}

async function getAnalysisJobByExternalId(
	db: D1Database,
	externalId: string,
): Promise<{
	externalId: string;
	newsTitle: string | null;
	status: AnalysisJobStatus;
	userMessage: string;
	analysisText: string | null;
	errorText: string | null;
	createdAt: string;
	updatedAt: string;
} | null> {
	const row = await db
		.prepare(
			`SELECT external_id, news_title, status, user_message, analysis_text, error_text, created_at, updated_at
			 FROM analysis_jobs
			 WHERE external_id = ?
			 LIMIT 1`,
		)
		.bind(externalId)
		.first<{
			external_id: string;
			news_title: string | null;
			status: AnalysisJobStatus;
			user_message: string;
			analysis_text: string | null;
			error_text: string | null;
			created_at: string;
			updated_at: string;
		}>();

	if (!row) {
		return null;
	}

	return {
		externalId: row.external_id,
		newsTitle: row.news_title,
		status: row.status,
		userMessage: row.user_message,
		analysisText: row.analysis_text,
		errorText: row.error_text,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function getLatestAnalysisJob(
	db: D1Database,
): Promise<{
	externalId: string;
	newsTitle: string | null;
	status: AnalysisJobStatus;
	userMessage: string;
	analysisText: string | null;
	errorText: string | null;
	createdAt: string;
	updatedAt: string;
} | null> {
	const doneRow = await db
		.prepare(
			`SELECT external_id, news_title, status, user_message, analysis_text, error_text, created_at, updated_at
			 FROM analysis_jobs
			 WHERE status = 'done'
			 ORDER BY updated_at DESC
			 LIMIT 1`,
		)
		.first<{
			external_id: string;
			news_title: string | null;
			status: AnalysisJobStatus;
			user_message: string;
			analysis_text: string | null;
			error_text: string | null;
			created_at: string;
			updated_at: string;
		}>();

	const row =
		doneRow ||
		(await db
			.prepare(
				`SELECT external_id, news_title, status, user_message, analysis_text, error_text, created_at, updated_at
				 FROM analysis_jobs
				 ORDER BY updated_at DESC
				 LIMIT 1`,
			)
			.first<{
				external_id: string;
				news_title: string | null;
				status: AnalysisJobStatus;
				user_message: string;
				analysis_text: string | null;
				error_text: string | null;
				created_at: string;
				updated_at: string;
			}>());

	if (!row) {
		return null;
	}

	return {
		externalId: row.external_id,
		newsTitle: row.news_title,
		status: row.status,
		userMessage: row.user_message,
		analysisText: row.analysis_text,
		errorText: row.error_text,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function upsertAnalysisJob(input: {
	db: D1Database;
	externalId: string;
	userMessage: string;
	status: AnalysisJobStatus;
	newsTitle: string | null;
	analysisText: string | null;
	errorText: string | null;
}): Promise<void> {
	const now = new Date().toISOString();
	await input.db
		.prepare(
			`INSERT INTO analysis_jobs (
				external_id, news_title, user_message, status, analysis_text, error_text, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(external_id) DO UPDATE SET
				news_title = COALESCE(excluded.news_title, analysis_jobs.news_title),
				user_message = excluded.user_message,
				status = excluded.status,
				analysis_text = excluded.analysis_text,
				error_text = excluded.error_text,
				updated_at = excluded.updated_at`,
		)
		.bind(
			input.externalId,
			input.newsTitle,
			input.userMessage.slice(0, 4000),
			input.status,
			input.analysisText ? input.analysisText.slice(0, 120000) : null,
			input.errorText ? input.errorText.slice(0, 1000) : null,
			now,
			now,
		)
		.run();
}

function sanitizeExternalId(raw: string): string | null {
	const normalized = raw.trim();
	if (normalized.length < 3 || normalized.length > 80) {
		return null;
	}
	if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
		return null;
	}
	return normalized;
}

function sanitizeNewsTitle(raw: string | null): string | null {
	if (typeof raw !== "string") {
		return null;
	}
	const normalized = raw.replace(/\s+/g, " ").trim();
	if (normalized.length === 0) {
		return null;
	}
	return normalized.slice(0, 500);
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	return "Unknown error";
}

type WebSearchResult = {
	title: string;
	url: string;
	content: string;
	score: number | null;
	publishedDate: string | null;
};

type WebSearchContext = {
	sourceUserMessage: string;
	query: string;
	answer: string | null;
	results: WebSearchResult[];
};

async function synthesizeWebSearchQuery(
	userMessage: string,
	env: Env,
): Promise<string> {
	const compactInput = sanitizeSearchField(userMessage, "").slice(0, 3000);
	if (compactInput.length === 0) {
		return "latest AI infrastructure and model launch news";
	}

	try {
		const response = (await env.AI.run(
			MODEL_ID,
			{
				messages: [
					{
						role: "system",
						content: [
							"You convert a long user message into one web-search query sentence.",
							"Output only the query text. No quotes. No markdown.",
							"Max 22 words.",
							"Focus on names, product/version, company, and core event.",
							"If no clear entities exist, output a concise topical query.",
						].join(" "),
					},
					{
						role: "user",
						content: compactInput,
					},
				],
				max_tokens: SEARCH_QUERY_MODEL_MAX_TOKENS,
				stream: false,
			},
			{},
		)) as {
			response?: string;
			result?: { response?: string };
			choices?: Array<{ message?: { content?: string } }>;
		};

		const text = extractNonStreamingModelText(response);
		const normalized = normalizeSearchQuery(text);
		if (normalized.length >= 5) {
			return normalized;
		}
	} catch (error) {
		console.error("Search query synthesis failed, falling back:", error);
	}

	return fallbackSearchQueryFromUserMessage(compactInput);
}

function extractNonStreamingModelText(response: {
	response?: string;
	result?: { response?: string };
	choices?: Array<{ message?: { content?: string } }>;
}): string {
	if (typeof response.response === "string" && response.response.trim().length > 0) {
		return response.response;
	}
	if (
		typeof response.result?.response === "string" &&
		response.result.response.trim().length > 0
	) {
		return response.result.response;
	}
	const messageContent = response.choices?.[0]?.message?.content;
	if (typeof messageContent === "string" && messageContent.trim().length > 0) {
		return messageContent;
	}
	return "";
}

function normalizeSearchQuery(text: string): string {
	return text
		.replace(/[\r\n]+/g, " ")
		.replace(/^["'`]+|["'`]+$/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 220);
}

function fallbackSearchQueryFromUserMessage(text: string): string {
	const trimmed = text.replace(/\s+/g, " ").trim();
	if (trimmed.length <= 220) {
		return trimmed;
	}
	const sentences = trimmed.split(/[.!?؟\n]+/).map((item) => item.trim());
	for (const sentence of sentences) {
		if (sentence.length >= 25) {
			return sentence.slice(0, 220);
		}
	}
	return trimmed.slice(0, 220);
}

async function fetchRequiredWebSearchContext(
	sourceUserMessage: string,
	query: string,
	env: Env,
): Promise<WebSearchContext> {
	const apiKey = getTavilyApiKey(env);
	if (!apiKey) {
		throw new Error(
			"TAVILY_API_KEY is not configured. Web search is mandatory for chat responses.",
		);
	}

	const response = await fetch(TAVILY_SEARCH_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			query,
			topic: "news",
			search_depth: "advanced",
			max_results: MAX_WEB_RESULTS,
			include_answer: "advanced",
			include_raw_content: false,
		}),
	});

	if (!response.ok) {
		const raw = await response.text();
		throw new Error(
			`Tavily search failed (${response.status}): ${raw.slice(0, 300)}`,
		);
	}

	const data = (await response.json()) as {
		query?: string;
		answer?: string;
		results?: Array<{
			title?: string;
			url?: string;
			content?: string;
			score?: number;
			published_date?: string;
		}>;
	};

	const results = (data.results || [])
		.filter((item) => typeof item.url === "string" && item.url.length > 0)
		.map((item) => ({
			title: sanitizeSearchField(item.title, "Untitled source"),
			url: item.url!.trim(),
			content: sanitizeSearchField(item.content, ""),
			score:
				typeof item.score === "number" && Number.isFinite(item.score)
					? item.score
					: null,
			publishedDate:
				typeof item.published_date === "string" && item.published_date.length > 0
					? item.published_date
					: null,
		}))
		.slice(0, MAX_WEB_RESULTS);

	if (results.length === 0) {
		throw new Error("Tavily returned no usable sources. Search is mandatory.");
	}

	const sourceMessage = sanitizeSearchField(sourceUserMessage, "").slice(0, 320);

	return {
		sourceUserMessage: sourceMessage.length > 0 ? sourceMessage : query,
		query: sanitizeSearchField(data.query, query),
		answer:
			typeof data.answer === "string" && data.answer.trim().length > 0
				? data.answer.trim().slice(0, 600)
				: null,
		results,
	};
}

function getTavilyApiKey(env: Env): string | null {
	const key = (env as Env & { TAVILY_API_KEY?: string }).TAVILY_API_KEY;
	if (typeof key !== "string") {
		return null;
	}
	const trimmed = key.trim();
	return trimmed.length > 0 ? trimmed : null;
}

async function fetchOptionalWebSearchContext(
	sourceUserMessage: string,
	query: string,
	env: Env,
): Promise<WebSearchContext | null> {
	const apiKey = getTavilyApiKey(env);
	if (!apiKey) {
		console.warn("TAVILY_API_KEY is not configured; continuing without web search.");
		return null;
	}

	try {
		return await fetchRequiredWebSearchContext(sourceUserMessage, query, env);
	} catch (error) {
		console.error("Optional web search failed:", error);
		return null;
	}
}

function buildSearchlessPrompt(sourceUserMessage: string, query: string): string {
	return [
		"Web search is unavailable for this analysis.",
		"Use only the available information and the user message below.",
		"Do not claim to have performed web search or cite external sources.",
		"Focus on the facts and generate a concise analysis based on the user's query and any internal reasoning.",
		"",
		`User message: ${sourceUserMessage.trim() || query}`,
	].join("\n");
}

function sanitizeSearchField(value: unknown, fallback: string): string {
	if (typeof value !== "string") {
		return fallback;
	}
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > 0 ? normalized.slice(0, 500) : fallback;
}

function buildWebSearchPrompt(context: WebSearchContext): string {
	const answerBlock = context.answer
		? `Tavily quick answer: ${context.answer}`
		: "Tavily quick answer: (none)";

	const sourceLines = context.results
		.map((item, index) => {
			const scoreText = item.score === null ? "n/a" : item.score.toFixed(3);
			const published = item.publishedDate ? ` | date: ${item.publishedDate}` : "";
			return [
				`${index + 1}. ${item.title}`,
				`URL: ${item.url}`,
				`score: ${scoreText}${published}`,
				`snippet: ${item.content || "(empty snippet)"}`,
			].join("\n");
		})
		.join("\n\n");

	return [
		"WEB_SEARCH_CONTEXT (MANDATORY EVIDENCE)",
		`Source user message: ${context.sourceUserMessage}`,
		`Synthesized search query: ${context.query}`,
		answerBlock,
		"Use these sources as the factual basis. Do not invent sources.",
		"At the end, include a \"منابع\" section and cite URLs from this list.",
		"Sources:",
		sourceLines,
	].join("\n");
}

async function storeArchiveWorthyAnalysis(input: {
	db: D1Database;
	ai: Ai;
	userMessage: string;
	assistantReply: string;
}): Promise<void> {
	const parsed = parseArchiveEvaluation(input.assistantReply);
	const structure = evaluateStructureQuality(input.assistantReply);
	const calibrated = await evaluateAnalysisQuality(input.ai, input.assistantReply);
	const finalScores = chooseFinalScores(parsed, calibrated);
	const archiveWorthy =
		parsed.archiveWorthy && structure.ok && finalScores.averageScore !== null && finalScores.averageScore >= 8;

	if (!archiveWorthy) {
		return;
	}

	await input.db
		.prepare(
			`INSERT INTO analysis_reference_samples (
				news_input, analysis_text, strategic_depth, practical_decision_value,
				intellectual_honesty, average_score, archive_worthy, created_at
			) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
		)
		.bind(
			input.userMessage,
			input.assistantReply.slice(0, 12000),
			finalScores.strategicDepth,
			finalScores.practicalDecisionValue,
			finalScores.intellectualHonesty,
			finalScores.averageScore,
			new Date().toISOString(),
		)
		.run();

	await input.db
		.prepare(
			`DELETE FROM analysis_reference_samples
			 WHERE id NOT IN (
				SELECT id FROM analysis_reference_samples ORDER BY average_score DESC, id DESC LIMIT 300
			 );`,
		)
		.run();
}

type QualityScores = {
	strategicDepth: number | null;
	practicalDecisionValue: number | null;
	intellectualHonesty: number | null;
	averageScore: number | null;
};

function chooseFinalScores(
	declared: QualityScores,
	calibrated: QualityScores | null,
): QualityScores {
	if (calibrated && calibrated.averageScore !== null) {
		return calibrated;
	}
	return declared;
}

function evaluateStructureQuality(reply: string): { ok: boolean } {
	const requiredPatterns = [
		/هوک/i,
		/(?:اصل خبر|خلاصه خبر)/i,
		/تحلیل خلاقانه/i,
		/فرصت/i,
		/ریسک/i,
		/آینده نزدیک/i,
		/اقدام عملی/i,
		/منابع/i,
	];
	const requiredNumericPatterns = [
		/Strategic Depth\s*[:=-]\s*\d+(?:\.\d+)?/i,
		/Practical Decision Value\s*[:=-]\s*\d+(?:\.\d+)?/i,
		/Intellectual Honesty\s*[:=-]\s*\d+(?:\.\d+)?/i,
		/(?:Average|میانگین)\s*[:=-]\s*\d+(?:\.\d+)?/i,
		/ARCHIVE_WORTHY\s*=\s*(?:TRUE|FALSE)/i,
	];
	const missingCore = requiredPatterns.filter((pattern) => !pattern.test(reply)).length;
	const missingNumeric = requiredNumericPatterns.filter((pattern) => !pattern.test(reply)).length;
	const hasUsefulLength = reply.trim().length >= 380;
	return { ok: missingCore <= 1 && missingNumeric <= 1 && hasUsefulLength };
}

async function evaluateAnalysisQuality(
	ai: Ai,
	reply: string,
): Promise<QualityScores | null> {
	try {
		const evaluation = (await ai.run(
			MODEL_ID,
			{
				messages: [
					{
						role: "system",
						content:
							"Score the Persian analysis strictly. Return only compact JSON with keys: strategicDepth, practicalDecisionValue, intellectualHonesty, averageScore. Each score must be 0..10.",
					},
					{
						role: "user",
						content: reply.slice(0, 9000),
					},
				],
				max_tokens: 200,
				stream: false,
			},
			{},
		)) as {
			response?: string;
			result?: { response?: string };
			choices?: Array<{ message?: { content?: string } }>;
		};

		const raw = extractNonStreamingModelText(evaluation).trim();
		const jsonText = extractJsonObject(raw);
		if (!jsonText) {
			return null;
		}
		const parsed = JSON.parse(jsonText) as Partial<Record<keyof QualityScores, unknown>>;
		const scores: QualityScores = {
			strategicDepth: normalizeScore(parsed.strategicDepth),
			practicalDecisionValue: normalizeScore(parsed.practicalDecisionValue),
			intellectualHonesty: normalizeScore(parsed.intellectualHonesty),
			averageScore: normalizeScore(parsed.averageScore),
		};

		if (scores.averageScore === null) {
			const available = [
				scores.strategicDepth,
				scores.practicalDecisionValue,
				scores.intellectualHonesty,
			].filter((value): value is number => value !== null);
			if (available.length > 0) {
				scores.averageScore = available.reduce((a, b) => a + b, 0) / available.length;
			}
		}
		return scores;
	} catch (error) {
		console.error("Quality calibration failed:", error);
		return null;
	}
}

function extractJsonObject(text: string): string | null {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end === -1 || end <= start) {
		return null;
	}
	return text.slice(start, end + 1);
}

function normalizeScore(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return Math.max(0, Math.min(10, value));
}

function parseArchiveEvaluation(reply: string): {
	archiveWorthy: boolean;
	strategicDepth: number | null;
	practicalDecisionValue: number | null;
	intellectualHonesty: number | null;
	averageScore: number | null;
} {
	const archiveWorthy = /ARCHIVE_WORTHY\s*=\s*TRUE/i.test(reply);
	const strategicDepth = extractScore(reply, "Strategic Depth");
	const practicalDecisionValue = extractScore(reply, "Practical Decision Value");
	const intellectualHonesty = extractScore(reply, "Intellectual Honesty");

	const scoreValues = [
		strategicDepth,
		practicalDecisionValue,
		intellectualHonesty,
	].filter((v): v is number => typeof v === "number" && Number.isFinite(v));

	const averageScore =
		scoreValues.length === 0
			? extractAverageScore(reply)
			: scoreValues.reduce((acc, v) => acc + v, 0) / scoreValues.length;

	return {
		archiveWorthy,
		strategicDepth,
		practicalDecisionValue,
		intellectualHonesty,
		averageScore,
	};
}

function extractScore(text: string, label: string): number | null {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = text.match(new RegExp(`${escaped}\\s*[:=-]\\s*(\\d+(?:\\.\\d+)?)`, "i"));
	if (!match) {
		return null;
	}
	const value = Number(match[1]);
	if (!Number.isFinite(value)) {
		return null;
	}
	return Math.max(0, Math.min(10, value));
}

function extractAverageScore(text: string): number | null {
	const avgMatch = text.match(
		/(?:Average|میانگین)\s*[:=-]\s*(\d+(?:\.\d+)?)/i,
	);
	if (!avgMatch) {
		return null;
	}
	const value = Number(avgMatch[1]);
	if (!Number.isFinite(value)) {
		return null;
	}
	return Math.max(0, Math.min(10, value));
}
