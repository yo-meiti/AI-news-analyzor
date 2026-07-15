/**
 * Public-safe Telegram bot worker.
 *
 * Responsibilities:
 * - accept bridge notifications at POST /notify
 * - fetch analysis text from the analyzer worker by external_id
 * - send analysis text to Telegram
 *
 * Sensitive values are expected from environment variables.
 */

const DEFAULT_CHAT_ID = "<TELEGRAM_USER_ID>";
const ANALYSIS_POLL_TIMEOUT_MS = 30000;
const ANALYSIS_POLL_INTERVAL_MS = 2500;
const TELEGRAM_MESSAGE_LIMIT = 3500;

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return json({ ok: true, service: "telegrambot" });
		}

		if (url.pathname === "/notify" && request.method === "POST") {
			return handleNotify(request, env);
		}

		if (url.pathname === "/webhook" && request.method === "POST") {
			return json({ ok: true, skipped: true });
		}

		return json({ ok: true, routes: ["/health", "/notify", "/webhook"] }, 200);
	},
};

async function handleNotify(request, env) {
	if (!env.TELEGRAM_BOT_TOKEN) {
		return json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN" }, 500);
	}
	if (!env.ANALYZER_API_BASE) {
		return json({ ok: false, error: "Missing ANALYZER_API_BASE" }, 500);
	}
	if (!isValidNotifyToken(request, env)) {
		return json({ ok: false, error: "Unauthorized notify call" }, 401);
	}

	let body;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: "Invalid JSON body" }, 400);
	}

	const externalId = sanitizeExternalId(
		typeof body?.external_id === "string"
			? body.external_id
			: typeof body?.externalId === "string"
				? body.externalId
				: typeof body?.id === "string"
					? body.id
					: "",
	);
	if (!externalId) {
		return json({ ok: false, error: "external_id is required and must be valid" }, 400);
	}

	const title = sanitizeTitle(
		typeof body?.title === "string"
			? body.title
			: typeof body?.news_title === "string"
				? body.news_title
				: typeof body?.newsTitle === "string"
					? body.newsTitle
					: "",
	);

	const targetChatId = sanitizeChatId(env.ALLOWED_TELEGRAM_USER_ID || DEFAULT_CHAT_ID);
	if (!targetChatId) {
		return json({ ok: false, error: "Missing ALLOWED_TELEGRAM_USER_ID" }, 500);
	}

	const job = await waitForAnalysisJob(env, externalId);
	if (!job || !job.analysisText) {
		return json(
			{
				ok: false,
				error: "Analysis not available in analyzer DB",
				external_id: externalId,
				title,
			},
			202,
		);
	}

	for (const chunk of chunkText(job.analysisText, TELEGRAM_MESSAGE_LIMIT)) {
		const sent = await sendTelegramMessage(env, targetChatId, chunk);
		if (!sent.ok) {
			return json(
				{
					ok: false,
					error: "Failed to send analysis text",
					code: "BOT_NOTIFY_001",
					external_id: externalId,
				},
				500,
			);
		}
	}

	return json(
		{
			ok: true,
			external_id: externalId,
			title: job.newsTitle || title || "بدون عنوان",
			analysis_fetched_from_db: true,
		},
		200,
	);
}

async function waitForAnalysisJob(env, externalId) {
	const deadline = Date.now() + ANALYSIS_POLL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const job = await getJobById(env, externalId);
		if (job?.analysisText && job.analysisText.trim()) {
			return job;
		}
		await delay(ANALYSIS_POLL_INTERVAL_MS);
	}
	return await getJobById(env, externalId);
}

async function getJobById(env, externalId) {
	try {
		const response = await fetch(
			`${trimSlash(env.ANALYZER_API_BASE)}/api/jobs/${encodeURIComponent(externalId)}`,
			{
				method: "GET",
				headers: { accept: "application/json" },
			},
		);

		if (!response.ok) {
			return null;
		}

		const data = await response.json().catch(() => null);
		return normalizeJob(data?.job);
	} catch {
		return null;
	}
}

async function sendTelegramMessage(env, chatId, text) {
	return telegramApi(env, "sendMessage", {
		chat_id: chatId,
		text,
		disable_web_page_preview: true,
	});
}

async function telegramApi(env, method, payload) {
	const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});

	let data;
	try {
		data = await response.json();
	} catch {
		data = { ok: false, error: "Invalid Telegram response JSON" };
	}

	return data;
}

function normalizeJob(job) {
	if (!job || typeof job !== "object") {
		return null;
	}

	const externalId = sanitizeExternalId(job.externalId || "");
	if (!externalId) {
		return null;
	}

	return {
		externalId,
		newsTitle: sanitizeTitle(job.newsTitle || ""),
		status: String(job.status || ""),
		userMessage: String(job.userMessage || ""),
		analysisText: typeof job.analysisText === "string" ? job.analysisText.replace(/\\n/g, "\n") : "",
		errorText: typeof job.errorText === "string" ? job.errorText : "",
	};
}

function chunkText(text, maxLen) {
	const chunks = [];
	let rest = String(text || "");
	while (rest.length > maxLen) {
		let splitAt = rest.lastIndexOf("\n", maxLen);
		if (splitAt < Math.floor(maxLen * 0.4)) {
			splitAt = maxLen;
		}
		chunks.push(rest.slice(0, splitAt).trim());
		rest = rest.slice(splitAt).trim();
	}
	if (rest.length > 0) {
		chunks.push(rest);
	}
	return chunks;
}

function isValidNotifyToken(request, env) {
	const expected = String(env.NOTIFY_SHARED_TOKEN || env.BOT_NOTIFY_TOKEN || "").trim();
	if (!expected) {
		return true;
	}

	const headerToken = (request.headers.get("x-notify-token") || "").trim();
	if (headerToken && headerToken === expected) {
		return true;
	}

	const auth = request.headers.get("authorization") || "";
	const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
	return Boolean(bearerMatch?.[1] && bearerMatch[1].trim() === expected);
}

function sanitizeExternalId(raw) {
	const normalized = String(raw || "").trim();
	if (normalized.length < 3 || normalized.length > 80) {
		return null;
	}
	if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
		return null;
	}
	return normalized;
}

function sanitizeTitle(text) {
	return String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function sanitizeChatId(value) {
	const normalized = String(value || "").trim();
	return normalized ? normalized : null;
}

function trimSlash(value) {
	return String(value || "").replace(/\/+$/, "");
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json" },
	});
}