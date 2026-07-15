import type { BridgeDO } from "./bridge-do";

export interface Env {
  BRIDGE_DO: DurableObjectNamespace<BridgeDO>;
  RSS_FEEDS: string;
  TELEGRAM_DEFAULT_CHAT_ID: string;
  ANALYZER_API_BASE: string;
  PROMPT_API_BASE: string;
  IMAGE_API_BASE: string;
  TELEGRAM_NOTIFY_URL: string;
  NOTIFY_SHARED_TOKEN: string;
  BOT_NOTIFY_TOKEN: string;
  RUN_SECRET: string;
}

export interface BridgeRunRequest {
  source?: string;
  runId?: string;
}

export interface RssItem {
  title: string;
  link: string;
  summary: string;
  sourceUrl: string;
  publishedAt: string | null;
}

export interface BridgeRunResult {
  ok: boolean;
  status: "idle" | "running" | "analysis_sent" | "sent" | "partial" | "duplicate" | "no-candidate" | "error";
  runId: string;
  externalId?: string;
  error?: string;
  errorCode?: string;
}

export interface DownstreamEndpoints {
  analyzerApiBase: string;
  promptApiBase: string;
  imageApiBase: string;
  telegramNotifyUrl: string;
  telegramNotifyToken: string;
  analyzerApiPath: string;
  promptApiPath: string;
  imageApiPath: string;
  telegramNotifyPath: string;
}
