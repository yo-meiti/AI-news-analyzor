import { DurableObject } from "cloudflare:workers";
import { buildNewsText, chooseBestItem, fetchRssFeed, makeExternalId, parseFeedUrls, parseRssXml } from "./rss";
import { BridgeRunResult, DownstreamEndpoints, Env, RssItem } from "./types";

type BridgeErrorCode =
  | "BRG_RSS_001"
  | "BRG_CANDIDATE_001"
  | "BRG_ANALYZER_001"
  | "BRG_ANALYZER_002"
  | "BRG_NOTIFY_001"
  | "BRG_PROMPT_001"
  | "BRG_IMAGE_001"
  | "BRG_IMAGE_002";

class BridgeFailure extends Error {
  code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function bridgeFailure(code: BridgeErrorCode, message: string): BridgeFailure {
  return new BridgeFailure(code, message);
}

export class BridgeDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS processed_items (
          external_id TEXT PRIMARY KEY,
          source_url TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS run_log (
          run_id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          external_id TEXT,
          error_text TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS pending_notifications (
          external_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          notify_at TEXT NOT NULL,
          delivered_at TEXT,
          status TEXT NOT NULL,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
    });
  }

  async run(payload: { runId?: string; source?: string } = {}): Promise<BridgeRunResult> {
    const runId = payload.runId ?? crypto.randomUUID();
    const startedAt = new Date().toISOString();

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO run_log (run_id, status, external_id, error_text, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, ?)`,
      runId,
      "running",
      startedAt,
      startedAt,
    );

    try {
      const item = await this.selectCandidate();
      if (!item) {
        this.ctx.storage.sql.exec(
          `UPDATE run_log SET status = ?, updated_at = ? WHERE run_id = ?`,
          "no-candidate",
          new Date().toISOString(),
          runId,
        );
        return { ok: true, status: "no-candidate", runId };
      }

      const externalId = makeExternalId(item.sourceUrl, item.title);
      if (this.isProcessed(externalId)) {
        this.ctx.storage.sql.exec(
          `UPDATE run_log SET status = ?, external_id = ?, updated_at = ? WHERE run_id = ?`,
          "duplicate",
          externalId,
          new Date().toISOString(),
          runId,
        );
        return { ok: true, status: "duplicate", runId, externalId };
      }

      this.markProcessed(externalId, item);

      await this.schedulePendingNotification(externalId, item.title, startedAt);

      const endpoints = this.getEndpoints();
      const analysisText = await this.callAnalyzer(endpoints, item, externalId);

      const prompt = await this.callPromptGenerator(endpoints, item);
      const imageResult = await this.callImageWorker(endpoints, prompt, item.title);
      if (!imageResult.ok) {
        throw bridgeFailure(
          "BRG_IMAGE_002",
          `Image worker returned HTTP ${imageResult.status}`,
        );
      }

      this.ctx.storage.sql.exec(
        `UPDATE run_log SET status = ?, external_id = ?, updated_at = ? WHERE run_id = ?`,
        "sent",
        externalId,
        new Date().toISOString(),
        runId,
      );

      return { ok: true, status: "sent", runId, externalId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown bridge error";
      const errorCode = error instanceof BridgeFailure ? error.code : undefined;
      this.ctx.storage.sql.exec(
        `UPDATE run_log SET status = ?, error_text = ?, updated_at = ? WHERE run_id = ?`,
        errorCode === "BRG_ANALYZER_002" ? "analysis_sent" : "error",
        message,
        new Date().toISOString(),
        runId,
      );
      return { ok: false, status: errorCode === "BRG_ANALYZER_002" ? "partial" : "error", runId, error: message, errorCode };
    }
  }

  async status(): Promise<Record<string, unknown>> {
    const runs = this.ctx.storage.sql.exec<{
      run_id: string;
      status: string;
      external_id: string | null;
      error_text: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT run_id, status, external_id, error_text, created_at, updated_at
       FROM run_log
       ORDER BY created_at DESC
       LIMIT 20`,
    ).toArray();

    const processed = this.ctx.storage.sql.exec<{ external_id: string; title: string; source_url: string; created_at: string }>(
      `SELECT external_id, title, source_url, created_at
       FROM processed_items
       ORDER BY created_at DESC
       LIMIT 50`,
    ).toArray();

    const pendingNotifications = this.ctx.storage.sql.exec<{
      external_id: string;
      title: string;
      notify_at: string;
      delivered_at: string | null;
      status: string;
      last_error: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT external_id, title, notify_at, delivered_at, status, last_error, created_at, updated_at
       FROM pending_notifications
       ORDER BY notify_at ASC
       LIMIT 20`,
    ).toArray();

    return { runs, processed, pendingNotifications };
  }

  async alarm(): Promise<void> {
    await this.processPendingNotifications();
    await this.scheduleNextPendingAlarm();
  }

  private async selectCandidate(): Promise<RssItem | null> {
    const feedUrls = parseFeedUrls(this.env.RSS_FEEDS);
    const allItems: RssItem[] = [];

    for (const feedUrl of feedUrls) {
      try {
        const xmlText = await fetchRssFeed(feedUrl);
        const parsedItems = parseRssXml(xmlText);
        allItems.push(...parsedItems);
      } catch {
        continue;
      }
    }

    const remaining = [...allItems];
    while (remaining.length > 0) {
      const candidate = chooseBestItem(remaining);
      if (!candidate) {
        return null;
      }

      const externalId = makeExternalId(candidate.sourceUrl, candidate.title);
      if (!this.isProcessed(externalId)) {
        return candidate;
      }

      const index = remaining.indexOf(candidate);
      if (index >= 0) {
        remaining.splice(index, 1);
      } else {
        break;
      }
    }

    return null;
  }

  private isProcessed(externalId: string): boolean {
    const rows = this.ctx.storage.sql.exec<{ external_id: string }>(
      `SELECT external_id FROM processed_items WHERE external_id = ? LIMIT 1`,
      externalId,
    ).toArray();
    return rows.length > 0;
  }

  private markProcessed(externalId: string, item: RssItem): void {
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO processed_items (external_id, source_url, title, created_at)
       VALUES (?, ?, ?, ?)`,
      externalId,
      item.sourceUrl,
      item.title,
      new Date().toISOString(),
    );
  }

  private getEndpoints(): DownstreamEndpoints {
    return {
      analyzerApiBase: this.env.ANALYZER_API_BASE ?? "",
      promptApiBase: this.env.PROMPT_API_BASE ?? "",
      imageApiBase: this.env.IMAGE_API_BASE ?? "",
      telegramNotifyUrl: this.env.TELEGRAM_NOTIFY_URL ?? "",
      telegramNotifyToken: this.env.NOTIFY_SHARED_TOKEN || this.env.BOT_NOTIFY_TOKEN || "",
      analyzerApiPath: "/api/chat",
      promptApiPath: "/api/prompts",
      imageApiPath: "/api/generate-to-telegram",
      telegramNotifyPath: "/notify",
    };
  }

  private async callAnalyzer(endpoints: DownstreamEndpoints, item: RssItem, externalId: string): Promise<string | null> {
    if (!endpoints.analyzerApiBase) {
      throw bridgeFailure("BRG_ANALYZER_001", "ANALYZER_API_BASE is not configured");
    }

    const response = await fetch(`${endpoints.analyzerApiBase.replace(/\/+$/, "")}${endpoints.analyzerApiPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        external_id: externalId,
        news_title: item.title,
        messages: [{ role: "user", content: buildNewsText(item) }],
      }),
    });

    if (!response.ok) {
      throw bridgeFailure("BRG_ANALYZER_002", `Analyzer request failed with status ${response.status}`);
    }

    const streamedText = await response.text();
    const analysisText = extractAnalysisTextFromStream(streamedText);
    return analysisText || null;
  }

  private async callPromptGenerator(endpoints: DownstreamEndpoints, item: RssItem): Promise<string> {
    if (!endpoints.promptApiBase) {
      throw bridgeFailure("BRG_PROMPT_001", "PROMPT_API_BASE is not configured");
    }

    const response = await fetch(`${endpoints.promptApiBase.replace(/\/+$/, "")}${endpoints.promptApiPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: buildNewsText(item) }),
    });

    if (!response.ok) {
      throw bridgeFailure("BRG_PROMPT_001", `Prompt generation failed with status ${response.status}`);
    }

    const data = await response.json() as { prompt?: string };
    if (!data.prompt) {
      throw new Error("Prompt generation returned no prompt");
    }
    return data.prompt;
  }

  private async callImageWorker(endpoints: DownstreamEndpoints, prompt: string, caption: string): Promise<Response> {
    if (!endpoints.imageApiBase) {
      throw bridgeFailure("BRG_IMAGE_001", "IMAGE_API_BASE is not configured");
    }

    return fetch(`${endpoints.imageApiBase.replace(/\/+$/, "")}${endpoints.imageApiPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        caption,
        chatId: this.env.TELEGRAM_DEFAULT_CHAT_ID || undefined,
      }),
    });
  }

  private async waitForAnalysisText(endpoints: DownstreamEndpoints, externalId: string): Promise<string | null> {
    const deadline = Date.now() + 22000;
    while (Date.now() < deadline) {
      const analysisText = await this.fetchAnalysisText(endpoints, externalId);
      if (analysisText) {
        return analysisText;
      }
      await delay(2000);
    }
    return null;
  }

  private async fetchAnalysisText(endpoints: DownstreamEndpoints, externalId: string): Promise<string | null> {
    if (!endpoints.analyzerApiBase) {
      throw bridgeFailure("BRG_ANALYZER_001", "ANALYZER_API_BASE is not configured");
    }

    const response = await fetch(
      `${endpoints.analyzerApiBase.replace(/\/+$/, "")}/api/jobs/${encodeURIComponent(externalId)}`,
      {
        method: "GET",
        headers: { accept: "application/json" },
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { job?: { analysisText?: string; analysis_text?: string } };
    const job = data?.job;
    const analysisText = job?.analysisText ?? job?.analysis_text ?? null;
    return typeof analysisText === "string" && analysisText.trim() ? analysisText.trim() : null;
  }

  private async callTelegramNotify(
    endpoints: DownstreamEndpoints,
    payload: { externalId: string; title: string; analysisText?: string; stage?: string; errorCode?: BridgeErrorCode; errorMessage?: string },
  ): Promise<Response> {
    if (!endpoints.telegramNotifyUrl) {
      throw bridgeFailure("BRG_NOTIFY_001", "TELEGRAM_NOTIFY_URL is not configured");
    }

    const response = await fetch(endpoints.telegramNotifyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-notify-token": endpoints.telegramNotifyToken,
      },
      body: JSON.stringify({
        external_id: payload.externalId,
        title: payload.title,
        analysis_text: payload.analysisText,
        stage: payload.stage,
        error_code: payload.errorCode,
        error_message: payload.errorMessage,
      }),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      throw bridgeFailure(
        "BRG_NOTIFY_001",
        `Telegram notify failed with status ${response.status}${responseText ? `: ${responseText}` : ""}`,
      );
    }

    return response;
  }

  private async schedulePendingNotification(externalId: string, title: string, startedAt: string): Promise<void> {
    const notifyAt = new Date(new Date(startedAt).getTime() + 40_000).toISOString();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO pending_notifications (
        external_id, title, notify_at, delivered_at, status, last_error, created_at, updated_at
       ) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?)`,
      externalId,
      title,
      notifyAt,
      "pending",
      startedAt,
      startedAt,
    );

    await this.ctx.storage.setAlarm(new Date(notifyAt).getTime());
  }

  private async processPendingNotifications(): Promise<void> {
    const now = new Date().toISOString();
    const dueNotifications = this.ctx.storage.sql.exec<{
      external_id: string;
      title: string;
    }>(
      `SELECT external_id, title
       FROM pending_notifications
       WHERE delivered_at IS NULL AND notify_at <= ?
       ORDER BY notify_at ASC
       LIMIT 20`,
      now,
    ).toArray();

    if (dueNotifications.length === 0) {
      return;
    }

    const endpoints = this.getEndpoints();
    for (const notification of dueNotifications) {
      try {
        await this.callTelegramNotify(endpoints, {
          externalId: notification.external_id,
          title: notification.title,
          stage: "analysis_ready",
        });
        this.ctx.storage.sql.exec(
          `UPDATE pending_notifications
           SET delivered_at = ?, status = ?, last_error = NULL, updated_at = ?
           WHERE external_id = ?`,
          new Date().toISOString(),
          "sent",
          new Date().toISOString(),
          notification.external_id,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown notify error";
        this.ctx.storage.sql.exec(
          `UPDATE pending_notifications
           SET status = ?, last_error = ?, updated_at = ?
           WHERE external_id = ?`,
          "error",
          message,
          new Date().toISOString(),
          notification.external_id,
        );
      }
    }
  }

  private async scheduleNextPendingAlarm(): Promise<void> {
    const rows = this.ctx.storage.sql.exec<{ notify_at: string }>(
      `SELECT notify_at
       FROM pending_notifications
       WHERE delivered_at IS NULL
       ORDER BY notify_at ASC
       LIMIT 1`,
    ).toArray();

    if (rows.length === 0) {
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
      return;
    }

    const nextTime = new Date(rows[0].notify_at).getTime();
    if (!Number.isNaN(nextTime)) {
      await this.ctx.storage.setAlarm(Math.max(Date.now(), nextTime));
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractAnalysisTextFromStream(streamText: string): string {
  const chunks: string[] = [];
  for (const line of streamText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    chunks.push(payload);
  }

  if (chunks.length === 0) {
    return streamText.trim();
  }

  return chunks.join("\n").trim();
}