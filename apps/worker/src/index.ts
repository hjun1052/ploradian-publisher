import { constantTimeEqual } from "./crypto";
import { runPublishingPipeline } from "./pipeline";

export default {
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      runPublishingPipeline(env, { trigger: "scheduled" })
        .then((result) => {
          console.log(JSON.stringify({ event: "scheduled_run_complete", result }));
        })
        .catch((error) => {
          console.error(
            JSON.stringify({
              event: "scheduled_run_unhandled_error",
              error: error instanceof Error ? error.message : String(error)
            })
          );
        })
    );
  },

  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "ploradian-publisher" }, 200);
    }

    if (url.pathname !== "/run") {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405, {
        allow: "POST"
      });
    }

    if (!(await isAuthorized(request, env))) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const trigger =
      url.searchParams.get("trigger") === "scheduled" && request.headers.get("x-ploradian-scheduled") === "1"
        ? "scheduled"
        : "manual";
    const runOptions: {
      trigger: "manual" | "scheduled";
      dryRunOverride?: boolean;
      forceMarket?: "korea" | "us";
      forceSerious?: boolean;
      ignoreSeen?: boolean;
    } = {
      trigger
    };
    if (url.searchParams.get("dry_run") === "true") {
      runOptions.dryRunOverride = true;
    }
    if (url.searchParams.get("ignore_seen") === "true") {
      runOptions.ignoreSeen = true;
    }
    const market = url.searchParams.get("market");
    if (market === "korea" || market === "us") {
      runOptions.forceMarket = market;
    }
    if (url.searchParams.get("serious") === "true") {
      runOptions.forceSerious = true;
    }
    const result = await runPublishingPipeline(env, runOptions);

    return json(result, result.ok ? 200 : 500);
  }
} satisfies ExportedHandler<Env>;

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const values = env as unknown as Record<string, string | undefined>;
  const secret = values.CRON_SECRET?.trim();
  if (!secret) {
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match?.[1]) {
    return false;
  }

  return constantTimeEqual(match[1], secret);
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}
