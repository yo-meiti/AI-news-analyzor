import { BridgeDO } from "./bridge-do";
import { BridgeRunRequest, Env } from "./types";

/*
  PLACEHOLDERS FOR ENV / API VALUES
  - RSS_FEEDS: comma-separated RSS URLs
  - ANALYZER_API_BASE: analyzer Worker URL
  - PROMPT_API_BASE: prompt generator Worker URL
  - IMAGE_API_BASE: image Worker URL
  - TELEGRAM_NOTIFY_URL: bot /notify endpoint
  - BOT_NOTIFY_TOKEN: secret token for /notify
  - TELEGRAM_DEFAULT_CHAT_ID: default Telegram chat id
  - Put these into Wrangler vars/secrets, not inline in code.
*/

export { BridgeDO };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "worker-bridge" });
    }

    if (url.pathname === "/status") {
      const stub = getBridgeStub(env);
      const status = await stub.status();
      return Response.json({ ok: true, status });
    }

    if (url.pathname === "/run-rss" && request.method === "POST") {
      const body = await readJson<BridgeRunRequest>(request);
      if (!isAuthorizedRun(request, env)) {
        return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      const stub = getBridgeStub(env);
      const result = await stub.run({ runId: body?.runId, source: body?.source ?? "manual" });
      if (!result.ok) {
        return Response.json(result, { status: 500 });
      }
      return Response.json(result);
    }

    if (url.pathname === "/run-rss" && request.method === "GET") {
      return new Response("Use POST /run-rss", { status: 405 });
    }

    if (request.method === "POST" && url.pathname === "/__scheduled") {
      ctx.waitUntil(getBridgeStub(env).run({ source: "cron" }));
      return Response.json({ ok: true, scheduled: true });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(getBridgeStub(env).run({ source: "cron" }));
  },
} satisfies ExportedHandler<Env>;

function getBridgeStub(env: Env): DurableObjectStub<BridgeDO> {
  return env.BRIDGE_DO.getByName("rss-bridge");
}

function isAuthorizedRun(request: Request, env: Env): boolean {
  const expected = env.RUN_SECRET.trim();
  if (!expected) {
    return true;
  }

  const headerToken = (request.headers.get("x-run-token") || "").trim();
  if (headerToken === expected) {
    return true;
  }

  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return Boolean(match?.[1] && match[1].trim() === expected);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
