/* eslint-disable */
// Generated scaffold types for worker-bridge.
// Run `npx wrangler types` after the project is wired to refresh these bindings.
import type { BridgeDO } from "./src/bridge-do";

declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./src/index");
  }
  interface Env {
    BRIDGE_DO: DurableObjectNamespace<BridgeDO>;
    RSS_FEEDS: string;
    TELEGRAM_DEFAULT_CHAT_ID: string;
    ANALYZER_API_BASE: string;
    PROMPT_API_BASE: string;
    IMAGE_API_BASE: string;
    TELEGRAM_NOTIFY_URL: string;
    BOT_NOTIFY_TOKEN: string;
    RUN_SECRET: string;
  }
}
interface Env extends Cloudflare.Env {}
