import { NowPaymentsError } from "./errors";

export interface HttpRequestOptions {
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Attach x-api-key header (default true). */
  apiKey?: boolean;
  /** Attach Authorization Bearer JWT (default false). */
  bearer?: boolean;
  headers?: Record<string, string>;
}

export interface HttpClientConfig {
  apiKey?: string;
  baseUrl: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  userAgent: string;
  getJwtToken?: (opts?: { forceRefresh?: boolean }) => Promise<string | null> | string | null;
}

function safeGet(headers: Headers, name: string): string | undefined {
  try {
    return headers.get(name) ?? undefined;
  } catch {
    return undefined;
  }
}

async function readBody(response: Response): Promise<unknown> {
  const contentType = safeGet(response.headers, "content-type") ?? "";
  if (response.status === 204) return null;
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function compactHeaders(entries: Array<[string, string | undefined]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out;
}

export class HttpClient {
  private readonly config: HttpClientConfig;

  constructor(config: HttpClientConfig) {
    if (typeof config.fetchImpl !== "function") {
      throw new NowPaymentsError({
        type: "NETWORK",
        code: "FETCH_UNAVAILABLE",
        message: "No fetch implementation is available — pass { fetch } to the client or use a fetch-capable runtime.",
      });
    }
    this.config = config;
  }

  private buildUrl(path: string, query?: Record<string, unknown>): URL {
    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  async request<T = unknown>(options: HttpRequestOptions): Promise<T> {
    const { method = "GET", path, query, body, apiKey = true, bearer = false, headers } = options;

    if (apiKey && !this.config.apiKey) {
      throw new NowPaymentsError({
        type: "CONFIGURATION",
        code: "MISSING_API_KEY",
        message: "NOWPayments API key is required for this request — pass apiKey to the client constructor.",
      });
    }

    let token: string | null = null;
    if (bearer) {
      const value = await this.config.getJwtToken?.();
      token = value ?? null;
      if (!token) {
        throw new NowPaymentsError({
          type: "CONFIGURATION",
          code: "MISSING_JWT",
          message: "This endpoint requires dashboard authentication — pass jwtToken or call authenticate() with email/password.",
        });
      }
    }

    const url = this.buildUrl(path, query);
    const requestHeaders = compactHeaders([
      ["accept", "application/json"],
      ["content-type", body === undefined ? undefined : "application/json"],
      ["user-agent", this.config.userAgent],
      ["x-api-key", apiKey ? this.config.apiKey : undefined],
      ["authorization", bearer && token ? `Bearer ${token}` : undefined],
      ...Object.entries(headers ?? {}),
    ]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.config.fetchImpl(url, {
          method,
          headers: requestHeaders,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new NowPaymentsError({
            type: "TIMEOUT",
            code: "REQUEST_TIMEOUT",
            message: `NOWPayments request timed out after ${this.config.timeoutMs}ms`,
            cause: error,
          });
        }
        throw new NowPaymentsError({
          type: "NETWORK",
          code: "NETWORK_ERROR",
          message: error instanceof Error ? error.message : "Network request failed",
          cause: error,
        });
      }

      const parsed = await readBody(response);
      if (!response.ok) {
        throw NowPaymentsError.fromResponse(response.status, parsed);
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
