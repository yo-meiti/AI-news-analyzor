/**
 * Telegram bot running on Cloudflare Workers.
 *
 * Required secrets:
 * - TELEGRAM_BOT_TOKEN
 * - ANALYZER_API_BASE (e.g. https://llm-chat-app-template-v2.ysblasqsla.workers.dev)
 *
 * Optional secrets:
 * - TELEGRAM_WEBHOOK_SECRET
 * - PUBLIC_WEBHOOK_URL (used by /set-webhook helper route)
 * - ALLOWED_TELEGRAM_USER_ID (numeric Telegram user id allowed to use bot)
 * - BOT_NOTIFY_TOKEN (for /notify endpoint called by n8n)
 * - TELEGRAM_CHANNEL_ID (target channel id or @channel_username for publish)
 */

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return json({ ok: true, service: "telegrambot" });
		}

		if (url.pathname === "/set-webhook" && request.method === "GET") {
			return handleSetWebhook(env);
		}

		if (url.pathname === "/delete-webhook" && request.method === "GET") {
			return handleDeleteWebhook(env);
		}

		if (url.pathname === "/notify" && request.method === "POST") {
			return handleNotify(request, env);
		}

		if (url.pathname === "/webhook" && request.method === "POST") {
			return handleTelegramWebhook(request, env);
		}

		return json(
			{
				ok: true,
				routes: ["/health", "/set-webhook", "/delete-webhook", "/notify", "/webhook"],
			},
			200,
		);
	},
};

async function handleNotify(request, env) {
	if (!env.TELEGRAM_BOT_TOKEN) {
		return json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN" }, 500);
	}
	if (!env.ALLOWED_TELEGRAM_USER_ID) {
		return json({ ok: false, error: "Missing ALLOWED_TELEGRAM_USER_ID" }, 500);
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

	const externalIdRaw =
		typeof body?.external_id === "string"
			? body.external_id
			: typeof body?.externalId === "string"
				? body.externalId
				: typeof body?.id === "string"
					? body.id
					: "";
	const externalId = sanitizeExternalId(externalIdRaw);
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

	const targetChatId = String(env.ALLOWED_TELEGRAM_USER_ID).trim();
	const textLines = [
		"شما یک تحلیل جدید دارید: مشاهده",
		`🆔 ${externalId}`,
		`📰 ${title || "بدون عنوان"}`,
	];
	const payload = {
		chat_id: targetChatId,
		text: textLines.join("\n"),
		disable_web_page_preview: true,
		reply_markup: buildJobActionKeyboard(externalId),
	};

	const sent = await telegramApi(env, "sendMessage", payload);
	if (!sent.ok) {
		return json({ ok: false, error: "Failed to send Telegram notify", telegram: sent }, 500);
	}

	return json({ ok: true, external_id: externalId, title });
}

async function handleTelegramWebhook(request, env) {
	if (!env.TELEGRAM_BOT_TOKEN) {
		return json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN" }, 500);
	}
	if (!env.ANALYZER_API_BASE) {
		return json({ ok: false, error: "Missing ANALYZER_API_BASE" }, 500);
	}

	if (env.TELEGRAM_WEBHOOK_SECRET) {
		const received = request.headers.get("x-telegram-bot-api-secret-token") || "";
		if (received !== env.TELEGRAM_WEBHOOK_SECRET) {
			return json({ ok: false, error: "Invalid webhook secret" }, 401);
		}
	}

	let update;
	try {
		update = await request.json();
	} catch {
		return json({ ok: false, error: "Invalid JSON body" }, 400);
	}

	if (update?.callback_query) {
		await handleCallbackQuery(update.callback_query, env);
		return json({ ok: true });
	}

	const message = update?.message || update?.edited_message;
	if (!message?.chat?.id) {
		return json({ ok: true, skipped: "No message/callback in update" });
	}

	await handleIncomingMessage(message, env);
	return json({ ok: true });
}

async function handleIncomingMessage(message, env) {
	const chatId = message.chat.id;
	const text = (message.text || "").trim();
	const fromUserId = message?.from?.id;
	const messageId = message?.message_id;

	if (!isAuthorizedUser(env, fromUserId)) {
		console.log("Unauthorized access blocked", { fromUserId, chatId, messageId });
		return;
	}

	if (!text) {
		await sendTelegramMessage(env, chatId, "فقط پیام متنی را می‌پذیرم.", messageId);
		return;
	}

	if (isCommand(text, "/start") || isCommand(text, "/help")) {
		await sendTelegramMessage(env, chatId, helpText(), messageId);
		return;
	}

	if (isCommand(text, "/latest")) {
		await sendLatestJob(env, chatId, messageId);
		return;
	}

	const newsCommand = parseNewsCommand(text);
	if (newsCommand) {
		await sendJobById(env, chatId, newsCommand.externalId, messageId);
		return;
	}

	const saveCommand = parseSaveCommand(text);
	if (saveCommand) {
		await saveJobEditAndShow(env, chatId, saveCommand.externalId, saveCommand.editedText, messageId);
		return;
	}

	await sendTelegramMessage(env, chatId, helpText(), messageId);
}

async function handleCallbackQuery(callbackQuery, env) {
	const callbackId = callbackQuery?.id;
	const data = (callbackQuery?.data || "").trim();
	const fromUserId = callbackQuery?.from?.id;
	const chatId = callbackQuery?.message?.chat?.id;
	const messageId = callbackQuery?.message?.message_id;

	if (!callbackId || !chatId || !data) {
		return;
	}

	if (!isAuthorizedUser(env, fromUserId)) {
		await answerCallbackQuery(env, callbackId, "دسترسی غیرمجاز");
		return;
	}

	const parsed = parseCallbackData(data);
	if (!parsed) {
		await answerCallbackQuery(env, callbackId, "داده دکمه نامعتبر است");
		return;
	}

	if (parsed.action === "view") {
		await answerCallbackQuery(env, callbackId, "در حال نمایش خبر");
		await sendJobById(env, chatId, parsed.externalId, messageId);
		return;
	}

	if (parsed.action === "edit") {
		await answerCallbackQuery(env, callbackId, "فرمت ویرایش ارسال شد");
		await sendTelegramMessage(
			env,
			chatId,
			`برای ویرایش همین خبر، این فرمت را بفرست:\n/save ${parsed.externalId} متن_ویرایش_شده`,
			messageId,
		);
		return;
	}

	if (parsed.action === "approve") {
		await answerCallbackQuery(env, callbackId, "در حال ارسال به کانال");
		await publishJobToChannel(env, chatId, parsed.externalId, messageId);
		return;
	}

	await answerCallbackQuery(env, callbackId, "دستور ناشناخته");
}

async function sendLatestJob(env, chatId, replyToMessageId) {
	const latest = await getLatestJob(env);
	if (!latest) {
		await sendTelegramMessage(env, chatId, "فعلا خبری برای نمایش پیدا نشد.", replyToMessageId);
		return;
	}
	await sendJobResult(env, chatId, latest, replyToMessageId);
}

async function sendJobById(env, chatId, externalId, replyToMessageId) {
	const job = await getJobById(env, externalId);
	if (!job) {
		await sendTelegramMessage(env, chatId, `خبری با شناسه ${externalId} پیدا نشد.`, replyToMessageId);
		return;
	}
	await sendJobResult(env, chatId, job, replyToMessageId);
}

async function saveJobEditAndShow(env, chatId, externalId, editedText, replyToMessageId) {
	if (editedText.trim().length < 20) {
		await sendTelegramMessage(
			env,
			chatId,
			"متن ویرایش خیلی کوتاه است. حداقل 20 کاراکتر بفرست.",
			replyToMessageId,
		);
		return;
	}

	const updated = await updateJobAnalysis(env, externalId, editedText);
	if (!updated) {
		await sendTelegramMessage(
			env,
			chatId,
			"ذخیره ویرایش انجام نشد. شناسه خبر را دوباره چک کن.",
			replyToMessageId,
		);
		return;
	}

	await sendTelegramMessage(env, chatId, `ویرایش ذخیره شد.\n🆔 ${externalId}`, replyToMessageId);
	await sendJobResult(env, chatId, updated, replyToMessageId);
}

async function publishJobToChannel(env, chatId, externalId, replyToMessageId) {
	const channelId = String(env.TELEGRAM_CHANNEL_ID || "").trim();
	if (!channelId) {
		await sendTelegramMessage(
			env,
			chatId,
			"TELEGRAM_CHANNEL_ID تنظیم نشده. انتشار انجام نشد.",
			replyToMessageId,
		);
		return;
	}

	const job = await getJobById(env, externalId);
	if (!job) {
		await sendTelegramMessage(env, chatId, "خبر پیدا نشد.", replyToMessageId);
		return;
	}
	if (!job.analysisText || !job.analysisText.trim()) {
		await sendTelegramMessage(env, chatId, "تحلیل خالی است و قابل انتشار نیست.", replyToMessageId);
		return;
	}

	const publishedText = buildPublishText(job);
	for (const chunk of chunkText(publishedText, 3500)) {
		const sent = await sendTelegramMessage(env, channelId, chunk);
		if (!sent?.ok) {
			await sendTelegramMessage(
				env,
				chatId,
				"ارسال به کانال شکست خورد. دسترسی ادمین بات را چک کن.",
				replyToMessageId,
			);
			return;
		}
	}

	await sendTelegramMessage(
		env,
		chatId,
		`خبر با موفقیت به کانال ارسال شد.\n🆔 ${externalId}`,
		replyToMessageId,
	);
}

async function sendJobResult(env, chatId, job, replyToMessageId) {
	const header = [
		"مشاهده خبر",
		`🆔 ${job.externalId}`,
		`📰 ${job.newsTitle || inferTitleFromUserMessage(job.userMessage)}`,
		`وضعیت: ${job.status}`,
	].join("\n");

	await sendTelegramMessage(env, chatId, header, replyToMessageId, buildJobActionKeyboard(job.externalId));

	const analysis = (job.analysisText || "").trim();
	if (!analysis) {
		await sendTelegramMessage(env, chatId, "تحلیل هنوز آماده نشده یا خالی است.", replyToMessageId);
		return;
	}

	for (const chunk of chunkText(analysis, 3500)) {
		await sendTelegramMessage(env, chatId, chunk, replyToMessageId);
	}
}

async function getLatestJob(env) {
	const response = await fetch(`${trimSlash(env.ANALYZER_API_BASE)}/api/jobs/latest`, {
		method: "GET",
		headers: { accept: "application/json" },
	});
	if (!response.ok) {
		return null;
	}
	const data = await response.json();
	return normalizeJob(data?.job);
}

async function getJobById(env, externalId) {
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
	const data = await response.json();
	return normalizeJob(data?.job);
}

async function updateJobAnalysis(env, externalId, analysisText) {
	const response = await fetch(
		`${trimSlash(env.ANALYZER_API_BASE)}/api/jobs/${encodeURIComponent(externalId)}`,
		{
			method: "PUT",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify({ analysis_text: analysisText }),
		},
	);
	if (!response.ok) {
		return null;
	}
	const data = await response.json();
	return normalizeJob(data?.job);
}

async function handleSetWebhook(env) {
	if (!env.TELEGRAM_BOT_TOKEN || !env.PUBLIC_WEBHOOK_URL) {
		return json(
			{
				ok: false,
				error: "Missing TELEGRAM_BOT_TOKEN or PUBLIC_WEBHOOK_URL",
			},
			500,
		);
	}

	const payload = {
		url: `${trimSlash(env.PUBLIC_WEBHOOK_URL)}/webhook`,
		drop_pending_updates: true,
	};
	if (env.TELEGRAM_WEBHOOK_SECRET) {
		payload.secret_token = env.TELEGRAM_WEBHOOK_SECRET;
	}

	const result = await telegramApi(env, "setWebhook", payload);
	return json(result, result.ok ? 200 : 500);
}

async function handleDeleteWebhook(env) {
	if (!env.TELEGRAM_BOT_TOKEN) {
		return json({ ok: false, error: "Missing TELEGRAM_BOT_TOKEN" }, 500);
	}
	const result = await telegramApi(env, "deleteWebhook", {
		drop_pending_updates: false,
	});
	return json(result, result.ok ? 200 : 500);
}

async function sendTelegramMessage(env, chatId, text, replyToMessageId, replyMarkup) {
	const payload = {
		chat_id: chatId,
		text,
		disable_web_page_preview: true,
	};
	if (replyToMessageId) {
		payload.reply_to_message_id = replyToMessageId;
	}
	if (replyMarkup) {
		payload.reply_markup = replyMarkup;
	}
	return telegramApi(env, "sendMessage", payload);
}

async function answerCallbackQuery(env, callbackQueryId, text) {
	return telegramApi(env, "answerCallbackQuery", {
		callback_query_id: callbackQueryId,
		text,
		show_alert: false,
	});
}

async function telegramApi(env, method, payload) {
	const token = env.TELEGRAM_BOT_TOKEN;
	const url = `https://api.telegram.org/bot${token}/${method}`;

	const response = await fetch(url, {
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

	if (!response.ok) {
		console.error(`Telegram API ${method} failed:`, response.status, data);
	}

	return data;
}

function normalizeJob(job) {
	if (!job || typeof job !== "object") {
		return null;
	}
	if (!sanitizeExternalId(job.externalId || "")) {
		return null;
	}
	return {
		externalId: String(job.externalId),
		newsTitle: sanitizeTitle(String(job.newsTitle || "")),
		status: String(job.status || ""),
		userMessage: String(job.userMessage || ""),
		analysisText:
			typeof job.analysisText === "string"
				? job.analysisText.replace(/\\n/g, "\n")
				: "",
		errorText: typeof job.errorText === "string" ? job.errorText : "",
	};
}

function buildJobActionKeyboard(externalId) {
	if (!isSafeForCallbackData(externalId)) {
		return undefined;
	}
	return {
		inline_keyboard: [
			[{ text: "مشاهده خبر", callback_data: `view:${externalId}` }],
			[
				{ text: "ویرایش خبر", callback_data: `edit:${externalId}` },
				{ text: "تایید خبر برای ارسال", callback_data: `approve:${externalId}` },
			],
		],
	};
}

function parseCallbackData(data) {
	const idx = data.indexOf(":");
	if (idx <= 0) {
		return null;
	}
	const action = data.slice(0, idx);
	const externalId = sanitizeExternalId(data.slice(idx + 1));
	if (!externalId) {
		return null;
	}
	if (!["view", "edit", "approve"].includes(action)) {
		return null;
	}
	return { action, externalId };
}

function isCommand(text, command) {
	return text === command || text.startsWith(`${command}@`);
}

function parseNewsCommand(text) {
	const match = text.match(/^\/news(?:@\w+)?\s+([a-zA-Z0-9._:-]{3,80})$/);
	if (!match?.[1]) {
		return null;
	}
	const externalId = sanitizeExternalId(match[1]);
	return externalId ? { externalId } : null;
}

function parseSaveCommand(text) {
	const match = text.match(/^\/save(?:@\w+)?\s+([a-zA-Z0-9._:-]{3,80})\s+([\s\S]+)$/);
	if (!match?.[1] || !match?.[2]) {
		return null;
	}
	const externalId = sanitizeExternalId(match[1]);
	if (!externalId) {
		return null;
	}
	return {
		externalId,
		editedText: match[2].trim(),
	};
}

function buildPublishText(job) {
	const title = job.newsTitle || inferTitleFromUserMessage(job.userMessage);
	return [`📰 ${title}`, `🆔 ${job.externalId}`, "", job.analysisText || ""].join("\n");
}

function inferTitleFromUserMessage(text) {
	const compact = String(text || "").replace(/\s+/g, " ").trim();
	if (!compact) {
		return "بدون عنوان";
	}
	return compact.slice(0, 160);
}

function sanitizeTitle(text) {
	return String(text || "").replace(/\s+/g, " ").trim().slice(0, 300);
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

function isSafeForCallbackData(externalId) {
	return typeof externalId === "string" && externalId.length <= 50;
}

function chunkText(text, maxLen) {
	const chunks = [];
	let rest = text || "";
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

function trimSlash(value) {
	return (value || "").replace(/\/+$/, "");
}

function isAuthorizedUser(env, fromUserId) {
	const allowedRaw = (env.ALLOWED_TELEGRAM_USER_ID || "").toString().trim();
	if (!allowedRaw) {
		return true;
	}
	if (fromUserId === undefined || fromUserId === null) {
		return false;
	}
	return String(fromUserId) === allowedRaw;
}

function isValidNotifyToken(request, env) {
	const expected = String(env.BOT_NOTIFY_TOKEN || "").trim();
	if (!expected) {
		return true;
	}
	const headerToken = (request.headers.get("x-notify-token") || "").trim();
	if (headerToken && headerToken === expected) {
		return true;
	}
	const auth = request.headers.get("authorization") || "";
	const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
	if (bearerMatch?.[1] && bearerMatch[1].trim() === expected) {
		return true;
	}
	return false;
}

function helpText() {
	return [
		"این بات رابط n8n و سرویس تحلیل است.",
		"",
		"دستورات:",
		"/latest",
		"/news <external_id>",
		"/save <external_id> متن_ویرایش_شده",
		"",
		"وقتی n8n خبر جدید بدهد، پیام اعلان با دکمه‌های مشاهده/ویرایش/تایید دریافت می‌کنی.",
	].join("\n");
}

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}
