export type ReflowClientOptions = {
  url?: string;
  token?: string;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
};

export class ReflowClientError extends Error {
  readonly code?: string | undefined;
  readonly hint?: string | undefined;
  readonly details?: Record<string, unknown> | undefined;

  constructor(readonly status: number, message: string, extras?: { code?: string; hint?: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = 'ReflowClientError';
    this.code = extras?.code;
    this.hint = extras?.hint;
    this.details = extras?.details;
  }
}

export class ReflowClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly requestFetch: typeof globalThis.fetch;

  constructor(options: ReflowClientOptions = {}) {
    this.baseUrl = (options.url ?? process.env.REFLOW_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    this.token = options.token ?? process.env.REFLOW_TOKEN;
    this.apiKey = options.apiKey ?? process.env.REFLOW_API_KEY;
    this.requestFetch = options.fetch ?? globalThis.fetch;
  }

  async call<T>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json', origin: this.baseUrl };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    const response = await this.requestFetch(`${this.baseUrl}/v1/operations/${operation}`, {
      method: 'POST', headers, body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => ({ message: response.statusText })) as unknown;
    if (!response.ok) {
      const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
      const message = typeof record.message === 'string' ? record.message : JSON.stringify(payload);
      throw new ReflowClientError(response.status, message, {
        ...(typeof record.code === 'string' ? { code: record.code } : {}),
        ...(typeof record.hint === 'string' ? { hint: record.hint } : {}),
        ...(record.details && typeof record.details === 'object' ? { details: record.details as Record<string, unknown> } : {}),
      });
    }
    if (typeof payload === 'object' && payload !== null && 'data' in payload) return payload.data as T;
    return payload as T;
  }
}
