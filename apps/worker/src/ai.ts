import { SATIRE_ENGINE_PROMPT } from "./generated/satire-engine";
import { fetchTextWithRetry } from "./http";
import type { FactSummary, GeneratedArticleJson, RuntimeConfig, SourceItem } from "./types";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

const factSchema = {
  type: "object",
  properties: {
    entities: { type: "array", items: { type: "string" } },
    numbers: { type: "array", items: { type: "string" } },
    dates: { type: "array", items: { type: "string" } },
    conflict_or_controversy: { type: "string" },
    money_stock_market_angle: { type: "string" },
    reader_relevance: { type: "string" },
    facts: { type: "array", items: { type: "string" } }
  },
  required: [
    "entities",
    "numbers",
    "dates",
    "conflict_or_controversy",
    "money_stock_market_angle",
    "reader_relevance",
    "facts"
  ],
  additionalProperties: false
} as const;

const articleSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    category: { type: "string" },
    slug: { type: "string" },
    body: { type: "string" },
    source_name: { type: "string" },
    source_url: { type: "string" },
    original_title: { type: "string" }
  },
  required: [
    "title",
    "subtitle",
    "category",
    "slug",
    "body",
    "source_name",
    "source_url",
    "original_title"
  ],
  additionalProperties: false
} as const;

export async function extractFacts(
  config: RuntimeConfig,
  source: SourceItem,
  pageText: string
): Promise<FactSummary> {
  return callModelJson<FactSummary>(
    config,
    "ploradian_fact_summary",
    factSchema,
    [
      {
        role: "system",
        content:
          "Extract only factual, non-copyrighted bullet points from source metadata. Output strict JSON. Do not copy source prose."
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            source_name: source.feedName,
            source_url: source.url,
            original_title: source.title,
            rss_summary: source.summary,
            page_text_excerpt: pageText
          },
          null,
          2
        )
      }
    ],
    1200
  );
}

export async function generateSatireArticle(
  config: RuntimeConfig,
  source: SourceItem,
  facts: FactSummary,
  correction?: string
): Promise<GeneratedArticleJson> {
  const article = await callModelJson<GeneratedArticleJson>(
    config,
    "ploradian_satire_article",
    articleSchema,
    [
      {
        role: "system",
        content: `${SATIRE_ENGINE_PROMPT}\n\nOutput strict JSON matching the requested schema.`
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            source_metadata: {
              source_name: source.feedName,
              source_url: source.url,
              original_title: source.title,
              category: source.category
            },
            extracted_facts: facts,
            correction
          },
          null,
          2
        )
      }
    ],
    2200
  );

  return {
    ...article,
    source_name: source.feedName,
    source_url: source.url,
    original_title: source.title,
    category: article.category.trim() || source.category
  };
}

async function callModelJson<T>(
  config: RuntimeConfig,
  schemaName: string,
  schema: object,
  input: Array<{ role: "system" | "user"; content: string }>,
  maxOutputTokens: number
): Promise<T> {
  if (config.aiProvider === "workers-ai") {
    return callWorkersAiJson<T>(config, schemaName, schema, input, maxOutputTokens);
  }

  return callOpenAIJson<T>(config, schemaName, schema, input, maxOutputTokens);
}

async function callWorkersAiJson<T>(
  config: RuntimeConfig,
  schemaName: string,
  schema: object,
  input: Array<{ role: "system" | "user"; content: string }>,
  maxOutputTokens: number
): Promise<T> {
  if (!config.workersAi) {
    throw new Error("Workers AI binding is not configured.");
  }

  const data = await config.workersAi.run(config.workersAiModel, {
    messages: input,
    max_tokens: maxOutputTokens,
    temperature: schemaName === "ploradian_satire_article" ? 0.7 : 0.2,
    response_format: {
      type: "json_schema",
      json_schema: schema
    }
  });

  return extractWorkersAiJson<T>(data, `Workers AI ${schemaName} JSON`);
}

async function callOpenAIJson<T>(
  config: RuntimeConfig,
  schemaName: string,
  schema: object,
  input: Array<{ role: "system" | "user"; content: string }>,
  maxOutputTokens: number
): Promise<T> {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai.");
  }

  const payload = {
    model: config.openaiModel,
    input,
    text: {
      format: {
        type: "json_schema",
        name: schemaName,
        strict: true,
        schema
      }
    },
    max_output_tokens: maxOutputTokens
  };

  const { response, text } = await fetchTextWithRetry(
    RESPONSES_URL,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openaiApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    {
      label: `OpenAI ${schemaName}`,
      timeoutMs: 45000,
      maxBytes: 98304,
      retries: 1
    }
  );

  if (!response.ok) {
    throw new Error(`OpenAI ${schemaName} failed with HTTP ${response.status}: ${text.slice(0, 600)}`);
  }

  const data = parseJson<Record<string, unknown>>(text, "OpenAI response");
  if (data.error) {
    throw new Error(`OpenAI ${schemaName} returned error: ${JSON.stringify(data.error)}`);
  }

  const outputText = extractOpenAIOutputText(data);
  return parseJson<T>(outputText, `OpenAI ${schemaName} JSON`);
}

function extractWorkersAiJson<T>(data: unknown, label: string): T {
  const record = asRecord(data);
  const response = record?.response;

  if (typeof response === "string") {
    return parseJson<T>(response, label);
  }

  if (isObject(response)) {
    return response as T;
  }

  if (typeof record?.text === "string") {
    return parseJson<T>(record.text, label);
  }

  if (typeof record?.output_text === "string") {
    return parseJson<T>(record.output_text, label);
  }

  throw new Error(`${label} did not contain JSON output: ${JSON.stringify(data).slice(0, 600)}`);
}

function extractOpenAIOutputText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string") {
    return data.output_text;
  }

  const output = Array.isArray(data.output) ? data.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") {
        chunks.push(record.text);
      }
    }
  }

  const joined = chunks.join("").trim();
  if (!joined) {
    throw new Error("OpenAI response did not contain output text.");
  }
  return joined;
}

function parseJson<T>(value: string, label: string): T {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
