import { BridgeDO } from "./bridge-do";
import { BridgeRunRequest, Env } from "./types";

export { BridgeDO };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "worker-bridge" });
    }

    if (url.pathname === "/status") {
      const stub = env.BRIDGE_DO.getByName("rss-bridge");
      return Response.json({ ok: true, status: await stub.status() });
    }

    if (url.pathname === "/run-rss" && request.method === "POST") {
      if (!isAuthorizedRun(request, env)) {
        return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
      const body = await readJson<BridgeRunRequest>(request);
      const result = await env.BRIDGE_DO.getByName("rss-bridge").run({
        runId: body?.runId,
        source: body?.source ?? "manual",
      });
      return Response.json(result, { status: result.ok ? 200 : 500 });
    }

    if (request.method === "POST" && url.pathname === "/__scheduled") {
      ctx.waitUntil(env.BRIDGE_DO.getByName("rss-bridge").run({ source: "cron" }));
      return Response.json({ ok: true, scheduled: true });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(env.BRIDGE_DO.getByName("rss-bridge").run({ source: "cron" }));
  },
} satisfies ExportedHandler<Env>;

function isAuthorizedRun(request: Request, env: Env): boolean {
  const expected = env.RUN_SECRET.trim();
  if (!expected) return true;

  const headerToken = (request.headers.get("x-run-token") || "").trim();
  if (headerToken === expected) return true;

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