import {
  MARKET_NONSENSE_ENGINE_PROMPT,
  NONSENSE_ENGINE_PROMPT,
  SATIRE_ENGINE_PROMPT,
  SERIOUS_ENGINE_PROMPT
} from "./generated/satire-engine";
import { fetchTextWithRetry } from "./http";
import type {
  FactSummary,
  GeneratedArticleJson,
  RuntimeConfig,
  SeriousCandidateEvaluation,
  SeriousEditorialStore,
  SourceItem
} from "./types";

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
    satire_targets: { type: "array", items: { type: "string" } },
    mockable_details: { type: "array", items: { type: "string" } },
    weak_points: { type: "array", items: { type: "string" } },
    corporate_euphemisms: { type: "array", items: { type: "string" } },
    facts: { type: "array", items: { type: "string" } }
  },
  required: [
    "entities",
    "numbers",
    "dates",
    "conflict_or_controversy",
    "money_stock_market_angle",
    "reader_relevance",
    "satire_targets",
    "mockable_details",
    "weak_points",
    "corporate_euphemisms",
    "facts"
  ],
  additionalProperties: false
} as const;

const articleSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    category: { type: "string", enum: ["기술", "비즈니스", "시장", "헛소리", "정색"] },
    slug: { type: "string" },
    satire_brief: {
      type: "object",
      properties: {
        target: { type: "string" },
        ridiculous_core: { type: "string" },
        straight_faced_defense: { type: "array", items: { type: "string" } },
        must_include_jabs: { type: "array", items: { type: "string" } },
        analogies: { type: "array", items: { type: "string" } }
      },
      required: ["target", "ridiculous_core", "straight_faced_defense", "must_include_jabs", "analogies"],
      additionalProperties: false
    },
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
    "satire_brief",
    "body",
    "source_name",
    "source_url",
    "original_title"
  ],
  additionalProperties: false
} as const;

const seriousEvaluationSchema = {
  type: "object",
  properties: {
    raw_score: { type: "number" },
    final_score: { type: "number" },
    axis: { type: "string", enum: ["노동", "생활경제", "기업", "규제/감시", "정책"] },
    institution: { type: "string" },
    angle_type: { type: "string" },
    angle: { type: "string" },
    who_benefits: { type: "string" },
    who_pays: { type: "string" },
    hidden_cost: { type: "string" },
    missing_question: { type: "string" },
    publish_decision: { type: "string", enum: ["publish", "hold", "reject"] },
    reasoning_note: { type: "string" }
  },
  required: [
    "raw_score",
    "final_score",
    "axis",
    "institution",
    "angle_type",
    "angle",
    "who_benefits",
    "who_pays",
    "hidden_cost",
    "missing_question",
    "publish_decision",
    "reasoning_note"
  ],
  additionalProperties: false
} as const;

export async function extractFacts(
  config: RuntimeConfig,
  source: SourceItem,
  pageText: string
): Promise<FactSummary> {
  if (source.synthetic && source.category === "헛소리") {
    return {
      entities: ["The Ploradian 헛소리 데스크"],
      numbers: [],
      dates: source.publishedAt ? [source.publishedAt] : [],
      conflict_or_controversy: "갈등도 논란도 거의 없으며, 바로 그 무의미함이 소재다.",
      money_stock_market_angle: "금융, 가격, 투자, 시장 영향은 없다.",
      reader_relevance: "독자가 얻을 실용 정보는 없고, 맥락 없는 기사 형식 자체가 목적이다.",
      satire_targets: ["신문 형식 자체", "무의미한 보도 태도", "과도하게 진지한 문장"],
      mockable_details: [source.title, source.summary].filter(Boolean),
      weak_points: ["읽을 이유가 없다는 점", "맥락이 회수되지 않는다는 점"],
      corporate_euphemisms: [],
      facts: [
        source.title,
        source.summary,
        pageText,
        "이 기사는 기술, 비즈니스, 시장 정보로 분류하지 않는다.",
        "헛소리 카테고리로 작성하되 진지한 신문 문체를 유지한다."
      ].filter(Boolean)
    };
  }

  if (source.synthetic && source.category === "시장") {
    return {
      entities: ["The Ploradian 시장 억지해석 데스크"],
      numbers: extractNumbers(source.summary),
      dates: source.publishedAt ? [source.publishedAt] : [],
      conflict_or_controversy: "실제 숫자와 말이 안 되는 해석이 의도적으로 충돌한다.",
      money_stock_market_angle: "공급된 등락률과 가격 숫자는 그대로 보존한다.",
      reader_relevance: "투자 정보가 아니라 숫자에 되도 않는 이유를 붙이는 시장 아무말 브리핑이다.",
      satire_targets: ["시장 마감 해석", "등락 이유를 사후에 붙이는 습관", "종목명 말장난"],
      mockable_details: source.summary.split("\n").filter((line) => line.startsWith("- ")),
      weak_points: ["숫자는 실제지만 이유는 고의로 무의미하다", "금융적 설명을 금지한다"],
      corporate_euphemisms: [],
      facts: source.summary.split("\n").filter(Boolean)
    };
  }

  return callModelJson<FactSummary>(
    config,
    "ploradian_fact_summary",
    factSchema,
    [
      {
        role: "system",
        content:
          "Extract grounded facts only. No source prose copying or invented claims. Prioritize source-specific attack material: exact target, names, numbers, dates, prices, claims, omissions, limitations, awkward wording, contradictions, and oddly mockable details. Fill mockable_details with at least 5 concrete details when available; weak_points must be specific, not broad themes. Strict JSON."
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
    1200,
    config.openaiUtilityModel
  );
}

export async function generateSatireArticle(
  config: RuntimeConfig,
  source: SourceItem,
  facts: FactSummary,
  correction?: string
): Promise<GeneratedArticleJson> {
  const prompt = articlePromptFor(source);
  const isRegularSatire = !source.synthetic;
  const article = await callModelJson<GeneratedArticleJson>(
    config,
    "ploradian_satire_article",
    articleSchema,
    [
      {
        role: "system",
        content: isRegularSatire
          ? `${prompt}

Final article now: sharp, funny, mean, rhythmic. First identify the exact target. Use concrete source details before metaphors. Chain each paragraph: named detail -> weak point -> fake defense -> quiet insult. 4-6 tight paragraphs, no repeated joke, no generic industry essay. Strict JSON.`
          : `${prompt}\n\nOutput strict JSON matching the requested schema.`
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
    isRegularSatire ? 2300 : 1500,
    isRegularSatire ? config.openaiArticleModel : config.openaiLightArticleModel
  );

  return {
    ...article,
    source_name: source.feedName,
    source_url: source.url,
    original_title: source.title,
    category: source.synthetic ? source.category : normalizeCategory(article.category || source.category)
  };
}

export async function evaluateSeriousCandidate(
  config: RuntimeConfig,
  source: SourceItem,
  pageText: string,
  history: SeriousEditorialStore
): Promise<SeriousCandidateEvaluation> {
  const evaluation = await callModelJson<SeriousCandidateEvaluation>(
    config,
    "ploradian_serious_evaluation",
    seriousEvaluationSchema,
    [
      {
        role: "system",
        content: `Score if this Korean society/economy/company/labor/policy item deserves a 정색 column. Strict JSON; do not write article.
Criteria: hidden cost/risk/responsibility/bargaining-power transfer; clear beneficiary/payer; Korean relevance; concrete source basis; missing question normal coverage avoids; not routine promo/personnel/ceremony/bland notice.
raw_score 0-100. publish only for concrete grounded angles. final_score initially equals raw_score.`
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            source_metadata: {
              source_name: source.feedName,
              source_url: source.url,
              original_title: source.title,
              axis: source.seriousAxis,
              institution: source.seriousInstitution
            },
            rss_summary: usefulText(source.summary) ? source.summary : "",
            page_text_excerpt: pageText.slice(0, 1200),
            recent_serious_history: history.recent.slice(0, 6)
          },
          null,
          2
        )
      }
    ],
    1400,
    config.openaiUtilityModel
  );

  return {
    ...evaluation,
    raw_score: clampScore(evaluation.raw_score),
    final_score: clampScore(evaluation.final_score),
    axis: source.seriousAxis ?? evaluation.axis,
    institution: source.seriousInstitution ?? evaluation.institution
  };
}

export async function generateSeriousArticle(
  config: RuntimeConfig,
  source: SourceItem,
  facts: FactSummary,
  evaluation: SeriousCandidateEvaluation,
  correction?: string
): Promise<GeneratedArticleJson> {
  const article = await callModelJson<GeneratedArticleJson>(
    config,
    "ploradian_serious_article",
    articleSchema,
    [
      {
        role: "system",
        content: `${SERIOUS_ENGINE_PROMPT}

Strict JSON. Use editorial judgment as structure, not metadata. Hide scoring. 4-6 tight paragraphs; cut background, repetition, soft recap.`
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            source_metadata: {
              source_name: source.feedName,
              source_url: source.url,
              original_title: source.title,
              category: "정색",
              axis: source.seriousAxis,
              institution: source.seriousInstitution
            },
            extracted_facts: facts,
            editorial_judgment: evaluation,
            correction
          },
          null,
          2
        )
      }
    ],
    2200,
    config.openaiArticleModel
  );

  return {
    ...article,
    source_name: source.feedName,
    source_url: source.url,
    original_title: source.title,
    category: "정색"
  };
}

export async function intensifySatireArticle(
  config: RuntimeConfig,
  source: SourceItem,
  facts: FactSummary,
  draft: GeneratedArticleJson,
  correction?: string
): Promise<GeneratedArticleJson> {
  const isNonsense = source.synthetic && source.category === "헛소리";
  const isMarketNonsense = source.synthetic && source.category === "시장";
  const prompt = articlePromptFor(source);
  const article = await callModelJson<GeneratedArticleJson>(
    config,
    "ploradian_satire_article",
    articleSchema,
    [
      {
        role: "system",
        content: isNonsense
          ? `${prompt}

Final 헛소리 pass: preserve anti-news, make it emptier/contextless/pointless. No useful essay or tech/business critique. Strict JSON.`
          : isMarketNonsense
            ? `${prompt}

Final 시장 pass: preserve numbers exactly. Make reasons more absurd/name-based and less financial. No normal recap logic. Strict JSON.`
          : `${prompt}

Final rewrite: keep facts, make it funnier/meaner/drier. Replace broad analogies with attacks on named source details. The target must be obvious in paragraph 1. Use brief jabs/defenses in body; analogies are secondary. No repeated joke. 4-6 paragraphs. Strict JSON.`
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
            existing_draft: draft,
            correction:
              correction ??
              (isNonsense
                ? "Keep pure 헛소리: contextless, useless, formal, shorter. Remove usefulness/business/critique."
                : isMarketNonsense
                  ? "Preserve percentages exactly. Reasons absurd, financially useless, name-based. Remove macro logic."
                  : "More deadpan corporate-defense satire. Hit at least 4 concrete source details, name the exact target early, and cut generic metaphors/industry essay.")
          },
          null,
          2
        )
      }
    ],
    1900,
    source.synthetic ? config.openaiLightArticleModel : config.openaiArticleModel
  );

  return {
    ...article,
    source_name: source.feedName,
    source_url: source.url,
    original_title: source.title,
    category: source.synthetic ? source.category : normalizeCategory(article.category || source.category)
  };
}

function articlePromptFor(source: SourceItem): string {
  if (source.synthetic && source.category === "헛소리") {
    return NONSENSE_ENGINE_PROMPT;
  }

  if (source.synthetic && source.category === "시장") {
    return MARKET_NONSENSE_ENGINE_PROMPT;
  }

  return SATIRE_ENGINE_PROMPT;
}

function extractNumbers(value: string): string[] {
  return value.match(/[+-]?\d+(?:,\d{3})*(?:\.\d+)?%?/g) ?? [];
}

function usefulText(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return Boolean(normalized && normalized !== "undefined" && normalized !== "null");
}

function normalizeCategory(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("ko-KR");

  if (["technology", "tech", "it", "ai", "기술"].includes(normalized)) {
    return "기술";
  }

  if (["business", "biz", "economy", "비즈니스", "경제"].includes(normalized)) {
    return "비즈니스";
  }

  if (["markets", "market", "finance", "financial", "금융", "시장", "증시"].includes(normalized)) {
    return "시장";
  }

  if (
    ["nonsense", "bullshit", "bs", "absurd", "anti-news", "antinote", "헛소리", "개소리", "뻘소리"].includes(
      normalized
    )
  ) {
    return "헛소리";
  }

  if (["serious", "column", "critique", "analysis", "정색", "칼럼", "논평"].includes(normalized)) {
    return "정색";
  }

  return value.trim();
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

async function callModelJson<T>(
  config: RuntimeConfig,
  schemaName: string,
  schema: object,
  input: Array<{ role: "system" | "user"; content: string }>,
  maxOutputTokens: number,
  openaiModel = config.openaiModel
): Promise<T> {
  if (config.aiProvider === "workers-ai") {
    return callWorkersAiJson<T>(config, schemaName, schema, input, maxOutputTokens);
  }

  return callOpenAIJson<T>(config, schemaName, schema, input, maxOutputTokens, openaiModel);
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
    temperature: schemaName === "ploradian_satire_article" ? 0.7 : schemaName === "ploradian_serious_article" ? 0.45 : 0.2,
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
  maxOutputTokens: number,
  model: string
): Promise<T> {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai.");
  }

  const payload = {
    model,
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
      timeoutMs: schemaName === "ploradian_satire_article" || schemaName === "ploradian_serious_article" ? 90000 : 30000,
      maxBytes: 98304,
      retries: 0
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
