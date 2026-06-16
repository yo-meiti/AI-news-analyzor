const MODEL = "@cf/black-forest-labs/flux-2-dev";
const DEFAULT_PROMPT = "cyberpunk alley in heavy rain, cinematic lighting";
const MAX_PROMPT_LENGTH = 500;

interface AppEnv extends Env {
	TELEGRAM_BOT_TOKEN?: string;
	TELEGRAM_WEBHOOK_SECRET?: string;
}

type JsonValue = Record<string, unknown> | null;

interface WorkersAiRunCompat {
	run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface TelegramSendResult {
	messageId?: number;
}

interface GenerateAndSendResult {
	imageBytes: Uint8Array;
	chatId: string;
	messageId?: number;
}

export default {
	async fetch(request: Request, env: AppEnv): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/") {
			return new Response(renderPage(DEFAULT_PROMPT), {
				headers: {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-store",
				},
			});
		}

		if (request.method === "POST" && url.pathname === "/api/generate") {
			const payload = await readJson(request);
			const prompt = validatePrompt(payload?.prompt);
			if (!prompt.ok) {
				return textResponse(prompt.error, 400);
			}

			const chatId = normalizeString(payload?.chatId) ?? normalizeString(env.TELEGRAM_DEFAULT_CHAT_ID);
			if (!chatId) {
				return textResponse("chatId is required (or set TELEGRAM_DEFAULT_CHAT_ID).", 400);
			}

			try {
				const result = await generateAndSendToTelegram(env, prompt.value, chatId, payload?.caption);
				const headers: Record<string, string> = {
					"content-type": "image/png",
					"cache-control": "no-store",
					"x-telegram-chat-id": result.chatId,
				};
				if (result.messageId !== undefined) {
					headers["x-telegram-message-id"] = String(result.messageId);
				}

				return new Response(result.imageBytes, {
					headers: {
						...headers,
					},
				});
			} catch (error) {
				console.error("Generate/send failed:", error);
				return textResponse(errorMessage(error, "Generate/send failed. Try again."), 500);
			}
		}

		if (request.method === "POST" && url.pathname === "/api/generate-to-telegram") {
			const payload = await readJson(request);
			const prompt = validatePrompt(payload?.prompt);
			if (!prompt.ok) {
				return textResponse(prompt.error, 400);
			}

			const chatId = normalizeString(payload?.chatId) ?? normalizeString(env.TELEGRAM_DEFAULT_CHAT_ID);
			if (!chatId) {
				return textResponse("chatId is required (or set TELEGRAM_DEFAULT_CHAT_ID).", 400);
			}

			try {
				const result = await generateAndSendToTelegram(env, prompt.value, chatId, payload?.caption);
				return jsonResponse(
					{
						ok: true,
						chatId: result.chatId,
						messageId: result.messageId ?? null,
					},
					200,
				);
			} catch (error) {
				console.error("Send to Telegram failed:", error);
				return textResponse(errorMessage(error, "Failed to send image to Telegram."), 500);
			}
		}

		if (request.method === "POST" && url.pathname === "/telegram/webhook") {
			return handleTelegramWebhook(request, env);
		}

		return textResponse("Not found", 404);
	},
} satisfies ExportedHandler<AppEnv>;

async function handleTelegramWebhook(request: Request, env: AppEnv): Promise<Response> {
	if (env.TELEGRAM_WEBHOOK_SECRET) {
		const secret = request.headers.get("x-telegram-bot-api-secret-token");
		if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
			return textResponse("Unauthorized", 401);
		}
	}

	const body = await readJson(request);
	const message = (body?.message ?? body?.edited_message) as Record<string, unknown> | undefined;
	const text = normalizeString(message?.text);
	const chatId = extractChatId(message);

	if (!chatId || !text) {
		return textResponse("ignored", 200);
	}

	if (!env.TELEGRAM_BOT_TOKEN) {
		return textResponse("TELEGRAM_BOT_TOKEN is not configured.", 500);
	}

	const prompt = text.startsWith("/imagine") ? text.replace("/imagine", "").trim() : text.trim();
	if (!prompt) {
		await sendTelegramText(env, chatId, "Prompt is empty. Example: /imagine cinematic neon city");
		return textResponse("ok", 200);
	}

	if (prompt.length > MAX_PROMPT_LENGTH) {
		await sendTelegramText(
			env,
			chatId,
			`Prompt is too long. Max ${MAX_PROMPT_LENGTH} characters.`,
		);
		return textResponse("ok", 200);
	}

	try {
		const imageBytes = await generateImage(env, prompt);
		await sendImageToTelegram(env, chatId, imageBytes, `Prompt: ${truncate(prompt, 180)}`);
		return textResponse("ok", 200);
	} catch (error) {
		console.error("Webhook generation failed:", error);
		await sendTelegramText(env, chatId, "Image generation failed. Try again.");
		return textResponse("ok", 200);
	}
}

async function generateImage(env: AppEnv, prompt: string): Promise<Uint8Array> {
	// Keep support for newer model IDs that may not be present in generated AiModels types yet.
	const ai = env.AI as unknown as WorkersAiRunCompat;
	const raw =
		MODEL === "@cf/black-forest-labs/flux-2-dev"
			? await ai.run(MODEL, buildFlux2Input(prompt))
			: await ai.run(MODEL, { prompt });
	return toBytes(raw);
}

function buildFlux2Input(prompt: string): Record<string, unknown> {
	const form = new FormData();
	form.append("prompt", prompt);
	form.append("width", "1024");
	form.append("height", "768");

	// Serialize FormData through Response to get a body stream + boundary content type.
	const formResponse = new Response(form);
	const body = formResponse.body;
	const contentType = formResponse.headers.get("content-type");
	if (!body || !contentType) {
		throw new Error("Failed to build multipart payload for FLUX.2.");
	}

	return {
		multipart: {
			body,
			contentType,
		},
	};
}

async function generateAndSendToTelegram(
	env: AppEnv,
	prompt: string,
	chatId: string,
	captionInput: unknown,
): Promise<GenerateAndSendResult> {
	const imageBytes = await generateImage(env, prompt);
	const caption = normalizeString(captionInput) ?? `Prompt: ${truncate(prompt, 180)}`;
	const sendResult = await sendImageToTelegram(env, chatId, imageBytes, caption);
	return {
		imageBytes,
		chatId,
		messageId: sendResult.messageId,
	};
}

async function sendImageToTelegram(
	env: AppEnv,
	chatId: string,
	imageBytes: Uint8Array,
	caption: string,
): Promise<TelegramSendResult> {
	const token = normalizeString(env.TELEGRAM_BOT_TOKEN);
	if (!token) {
		throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
	}

	const form = new FormData();
	form.append("chat_id", chatId);
	form.append("caption", truncate(caption, 1024));
	form.append("photo", new Blob([imageBytes], { type: "image/png" }), "generated.png");

	const response = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
		method: "POST",
		body: form,
	});
	const text = await response.text();
	const parsed = parseJson(text);

	if (!response.ok) {
		throw new Error(`Telegram API error (${response.status}): ${truncate(text, 300)}`);
	}
	if (!parsed || parsed.ok !== true) {
		throw new Error(`Telegram rejected request: ${truncate(text, 300)}`);
	}

	const result = parsed.result as Record<string, unknown> | undefined;
	return { messageId: typeof result?.message_id === "number" ? result.message_id : undefined };
}

async function sendTelegramText(env: AppEnv, chatId: string, text: string): Promise<void> {
	const token = normalizeString(env.TELEGRAM_BOT_TOKEN);
	if (!token) return;

	await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			chat_id: chatId,
			text: truncate(text, 4096),
		}),
	});
}

async function readJson(request: Request): Promise<JsonValue> {
	try {
		return (await request.json()) as JsonValue;
	} catch {
		return null;
	}
}

function parseJson(text: string): Record<string, unknown> | null {
	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function validatePrompt(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
	const prompt = normalizeString(value);
	if (!prompt) {
		return { ok: false, error: "Prompt is required." };
	}
	if (prompt.length > MAX_PROMPT_LENGTH) {
		return { ok: false, error: `Prompt is too long (max ${MAX_PROMPT_LENGTH} chars).` };
	}
	return { ok: true, value: prompt };
}

function normalizeString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function extractChatId(message: Record<string, unknown> | undefined): string | null {
	if (!message) return null;
	const chat = message.chat as Record<string, unknown> | undefined;
	const id = chat?.id;
	if (typeof id === "number" || typeof id === "string") {
		return String(id);
	}
	return null;
}

async function toBytes(input: unknown): Promise<Uint8Array> {
	if (input instanceof Uint8Array) return input;
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
	if (typeof input === "string") {
		const decoded = decodeBase64Image(input);
		if (decoded) return decoded;
	}
	if (input && typeof input === "object") {
		const record = input as Record<string, unknown>;
		const imageText = typeof record.image === "string" ? record.image : null;
		if (imageText) {
			const decoded = decodeBase64Image(imageText);
			if (decoded) return decoded;
		}
	}
	try {
		const buffer = await new Response(input as BodyInit).arrayBuffer();
		return new Uint8Array(buffer);
	} catch {
		throw new Error("Unsupported image output from model.");
	}
}

function decodeBase64Image(value: string): Uint8Array | null {
	const trimmed = value.trim();
	if (!trimmed) return null;

	const base64Part =
		trimmed.startsWith("data:") && trimmed.includes(",")
			? trimmed.slice(trimmed.indexOf(",") + 1)
			: trimmed;
	const normalized = base64Part.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
	const paddingLength = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
	const padded = normalized + "=".repeat(paddingLength);

	if (!/^[A-Za-z0-9+/]+=*$/.test(padded)) {
		return null;
	}

	try {
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	} catch {
		return null;
	}
}

function truncate(value: string, length: number): string {
	return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function textResponse(text: string, status: number): Response {
	return new Response(text, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
}

function jsonResponse(data: unknown, status: number): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

function renderPage(defaultPrompt: string): string {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Text to Image</title>
		<link rel="preconnect" href="https://fonts.googleapis.com" />
		<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
		<link
			href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Syne:wght@700;800&display=swap"
			rel="stylesheet"
		/>
		<style>
			:root {
				--bg-top: #f7f4ea;
				--bg-bottom: #d9efe5;
				--ink: #132023;
				--accent: #ff6a3d;
				--accent-2: #0f9a8a;
				--panel: rgba(255, 255, 255, 0.82);
				--panel-border: rgba(19, 32, 35, 0.12);
				--muted: rgba(19, 32, 35, 0.72);
				--danger: #b2382f;
			}
			* { box-sizing: border-box; }
			body {
				margin: 0;
				min-height: 100vh;
				font-family: "Space Grotesk", "Avenir Next", "Segoe UI", sans-serif;
				color: var(--ink);
				background:
					radial-gradient(circle at 10% 20%, rgba(255, 106, 61, 0.2), transparent 35%),
					radial-gradient(circle at 90% 0%, rgba(15, 154, 138, 0.2), transparent 38%),
					linear-gradient(160deg, var(--bg-top), var(--bg-bottom));
				padding: 2rem 1rem 3rem;
			}
			main {
				max-width: 1040px;
				margin: 0 auto;
				display: grid;
				grid-template-columns: 1fr 1.2fr;
				gap: 1rem;
			}
			.card {
				background: var(--panel);
				backdrop-filter: blur(5px);
				border: 1px solid var(--panel-border);
				border-radius: 18px;
				padding: 1rem;
				box-shadow: 0 12px 28px rgba(19, 32, 35, 0.08);
			}
			h1 {
				margin: 0 0 0.65rem;
				font-family: "Syne", "Space Grotesk", sans-serif;
				font-size: clamp(1.8rem, 3vw, 2.8rem);
				line-height: 1.02;
				letter-spacing: -0.02em;
			}
			.tag {
				display: inline-block;
				font-size: 0.77rem;
				font-weight: 700;
				background: rgba(255, 106, 61, 0.14);
				color: #7f2b11;
				padding: 0.32rem 0.62rem;
				border-radius: 999px;
				margin-bottom: 0.75rem;
			}
			p {
				margin: 0 0 1rem;
				color: var(--muted);
				line-height: 1.5;
			}
			form {
				display: grid;
				gap: 0.7rem;
			}
			textarea, input[type="text"] {
				width: 100%;
				border: 1px solid rgba(19, 32, 35, 0.15);
				border-radius: 14px;
				font: inherit;
				padding: 0.9rem;
				background: rgba(255, 255, 255, 0.9);
				color: var(--ink);
			}
			textarea {
				min-height: 130px;
				resize: vertical;
			}
			textarea:focus, input[type="text"]:focus {
				outline: 2px solid rgba(15, 154, 138, 0.4);
				outline-offset: 1px;
			}
			.actions {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 0.65rem;
			}
			button {
				border: 0;
				border-radius: 12px;
				padding: 0.85rem 1rem;
				font: inherit;
				font-weight: 700;
				color: #fff;
				background: linear-gradient(120deg, var(--accent), #ff914d);
				cursor: pointer;
				transition: transform 0.18s ease, opacity 0.18s ease;
			}
			button.secondary {
				background: linear-gradient(120deg, var(--accent-2), #0bb098);
			}
			button:hover { transform: translateY(-1px); }
			button:disabled {
				cursor: not-allowed;
				opacity: 0.7;
				transform: none;
			}
			#status {
				min-height: 1.35rem;
				font-size: 0.92rem;
				color: var(--muted);
			}
			#status[data-type="error"] { color: var(--danger); }
			.preview {
				display: grid;
				place-items: center;
				min-height: 420px;
				background:
					repeating-linear-gradient(
						-45deg,
						rgba(19, 32, 35, 0.04),
						rgba(19, 32, 35, 0.04) 12px,
						rgba(19, 32, 35, 0.08) 12px,
						rgba(19, 32, 35, 0.08) 24px
					);
				border-radius: 14px;
				border: 1px solid rgba(19, 32, 35, 0.15);
				overflow: hidden;
				position: relative;
			}
			.preview[data-loading="true"]::after {
				content: "Rendering image...";
				position: absolute;
				inset: 0;
				display: grid;
				place-items: center;
				font-weight: 700;
				color: #083f38;
				background: rgba(226, 245, 240, 0.82);
				animation: pulse 1.2s ease-in-out infinite;
			}
			@keyframes pulse {
				0%, 100% { opacity: 0.75; }
				50% { opacity: 1; }
			}
			#result {
				width: 100%;
				height: 100%;
				max-height: 640px;
				object-fit: contain;
				display: none;
			}
			#placeholder {
				text-align: center;
				padding: 1.2rem;
				color: rgba(19, 32, 35, 0.65);
				max-width: 340px;
			}
			#download {
				display: none;
				margin-top: 0.7rem;
				font-size: 0.92rem;
				color: #065850;
				font-weight: 600;
				text-decoration-thickness: 2px;
			}
			@media (max-width: 880px) {
				main { grid-template-columns: 1fr; }
				.preview { min-height: 320px; }
				.actions { grid-template-columns: 1fr; }
			}
		</style>
	</head>
	<body>
		<main>
			<section class="card">
				<span class="tag">Workers AI + Telegram</span>
				<h1>Text to Image Studio</h1>
				<p>Prompt بده، تصویر بگیر، یا مستقیم برای بات تلگرام بفرست.</p>
				<form id="prompt-form">
					<label for="prompt">Prompt</label>
					<textarea id="prompt" name="prompt" maxlength="${MAX_PROMPT_LENGTH}">${defaultPrompt}</textarea>
					<label for="chat-id">Telegram Chat ID (optional)</label>
					<input id="chat-id" name="chat-id" type="text" placeholder="e.g. 123456789" />
					<div class="actions">
						<button id="generate-btn" type="submit" data-action="preview">Generate Image</button>
						<button id="telegram-btn" type="submit" class="secondary" data-action="telegram">Send to Telegram</button>
					</div>
				</form>
				<div id="status" role="status" aria-live="polite"></div>
				<a id="download" download="generated-image.png">Download image</a>
			</section>
			<section class="card preview" id="preview">
				<p id="placeholder">Your generated image will appear here.</p>
				<img id="result" alt="Generated result" />
			</section>
		</main>
		<script>
			const form = document.getElementById("prompt-form");
			const promptInput = document.getElementById("prompt");
			const chatIdInput = document.getElementById("chat-id");
			const status = document.getElementById("status");
			const generateBtn = document.getElementById("generate-btn");
			const telegramBtn = document.getElementById("telegram-btn");
			const preview = document.getElementById("preview");
			const placeholder = document.getElementById("placeholder");
			const result = document.getElementById("result");
			const download = document.getElementById("download");
			let objectUrl = null;

			form.addEventListener("submit", async (event) => {
				event.preventDefault();
				const prompt = promptInput.value.trim();
				const chatId = chatIdInput.value.trim();
				const action = event.submitter?.dataset?.action || "preview";

				if (!prompt) {
					setStatus("Prompt is required.", "error");
					return;
				}

				setLoading(true);

				try {
					if (action === "telegram") {
						setStatus("Sending image to Telegram...");
						await sendToTelegram(prompt, chatId);
						setStatus("Image sent to Telegram.");
					} else {
						setStatus("Generating image and sending to Telegram...");
						await generatePreview(prompt, chatId);
						setStatus("Image is ready and sent to Telegram.");
					}
				} catch (error) {
					setStatus(error instanceof Error ? error.message : "Unexpected error.", "error");
				} finally {
					setLoading(false);
				}
			});

			async function generatePreview(prompt, chatId) {
				const response = await fetch("/api/generate", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ prompt, chatId }),
				});
				if (!response.ok) {
					const message = await response.text();
					throw new Error(message || "Generation failed.");
				}
				const imageBlob = await response.blob();
				if (objectUrl) URL.revokeObjectURL(objectUrl);
				objectUrl = URL.createObjectURL(imageBlob);
				result.src = objectUrl;
				result.style.display = "block";
				placeholder.style.display = "none";
				download.href = objectUrl;
				download.style.display = "inline-block";
			}

			async function sendToTelegram(prompt, chatId) {
				const response = await fetch("/api/generate-to-telegram", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ prompt, chatId }),
				});
				if (!response.ok) {
					const message = await response.text();
					throw new Error(message || "Telegram send failed.");
				}
			}

			function setLoading(isLoading) {
				preview.dataset.loading = String(isLoading);
				generateBtn.disabled = isLoading;
				telegramBtn.disabled = isLoading;
				generateBtn.textContent = isLoading ? "Working..." : "Generate Image";
				telegramBtn.textContent = isLoading ? "Working..." : "Send to Telegram";
			}

			function setStatus(message, type = "info") {
				status.dataset.type = type;
				status.textContent = message;
			}
		</script>
	</body>
</html>`;
}
