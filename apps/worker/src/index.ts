import { constantTimeEqual } from "./crypto";
import { runPublishingPipeline } from "./pipeline";

export default {
  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      runScheduledPipeline(env)
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
    const runOptions: { trigger: "manual" | "scheduled"; dryRunOverride?: boolean } = { trigger };
    if (url.searchParams.get("dry_run") === "true") {
      runOptions.dryRunOverride = true;
    }
    const result = await runPublishingPipeline(env, runOptions);

    return json(result, result.ok ? 200 : 500);
  }
} satisfies ExportedHandler<Env>;

async function runScheduledPipeline(env: Env): Promise<unknown> {
  const values = env as unknown as Record<string, string | undefined>;
  const configuredUrl = values.SCHEDULED_RUN_URL?.trim();
  const secret = values.CRON_SECRET?.trim();

  if (configuredUrl && secret) {
    const url = new URL(configuredUrl);
    url.searchParams.set("trigger", "scheduled");

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-ploradian-scheduled": "1"
      }
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`Scheduled /run failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    return parseJsonBody(body);
  }

  return runPublishingPipeline(env, { trigger: "scheduled" });
}

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

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
