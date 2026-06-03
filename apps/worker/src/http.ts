export interface FetchTextOptions {
  label: string;
  timeoutMs: number;
  maxBytes: number;
  retries: number;
  encoding?: string;
}

export interface TextFetchResult {
  response: Response;
  text: string;
  truncated: boolean;
}

export class HttpError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export async function fetchTextWithRetry(
  input: string | URL | Request,
  init: RequestInit,
  options: FetchTextOptions
): Promise<TextFetchResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init, options.timeoutMs);
      const { text, truncated } = await readResponsePrefix(response, options.maxBytes, options.encoding);

      if (response.ok || !shouldRetryStatus(response.status) || attempt === options.retries) {
        return { response, text, truncated };
      }

      lastError = new HttpError(
        `${options.label} returned retryable HTTP ${response.status}`,
        response.status,
        text
      );
    } catch (error) {
      lastError = error;
      if (attempt === options.retries) {
        break;
      }
    }

    await sleep(Math.min(3000, 350 * 2 ** attempt));
  }

  throw lastError instanceof Error ? lastError : new Error(`${options.label} failed.`);
}

export async function readResponsePrefix(
  response: Response,
  maxBytes: number,
  fallbackEncoding = "utf-8"
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    return { text: "", truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;

  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const remaining = maxBytes - received;
      if (value.length > remaining) {
        chunks.push(value.slice(0, remaining));
        received += remaining;
        truncated = true;
        await reader.cancel("response size cap reached");
        break;
      }
      chunks.push(value);
      received += value.length;
    }

    if (received >= maxBytes) {
      truncated = true;
      await reader.cancel("response size cap reached");
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return {
    text: decodeBytes(combined, response, fallbackEncoding),
    truncated
  };
}

function decodeBytes(bytes: Uint8Array, response: Response, fallbackEncoding: string): string {
  const encoding = sniffEncoding(bytes, response.headers.get("content-type")) ?? fallbackEncoding;
  try {
    return new TextDecoder(encoding, { fatal: false, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes);
  }
}

function sniffEncoding(bytes: Uint8Array, contentType: string | null): string | null {
  const headerMatch = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType ?? "");
  if (headerMatch?.[1]) {
    return normalizeEncoding(headerMatch[1]);
  }

  const asciiPrefix = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
  const xmlMatch = /<\?xml[^>]*encoding=["']([^"']+)["']/i.exec(asciiPrefix);
  if (xmlMatch?.[1]) {
    return normalizeEncoding(xmlMatch[1]);
  }

  const metaMatch = /charset\s*=\s*["']?([^;"'\s>]+)/i.exec(asciiPrefix);
  return metaMatch?.[1] ? normalizeEncoding(metaMatch[1]) : null;
}

function normalizeEncoding(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "ks-c-5601" || normalized === "ksc5601" || normalized === "cp949") {
    return "euc-kr";
  }
  return normalized;
}

function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
