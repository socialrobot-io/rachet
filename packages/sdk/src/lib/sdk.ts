export type ReflowSdkOptions = {
  url: string;
  apiKey?: string;
  token?: string;
  workspaceId: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
};

export type TriggerContact = {
  email: string;
  externalId?: string;
  timezone?: string;
  fields?: Record<string, unknown>;
};

export type TriggerWorkflowInput = {
  workflowVersionId: string;
  contact: TriggerContact;
  variables?: Record<string, unknown>;
  idempotencyKey: string;
};

export type ReflowContact = TriggerContact & { id: string; workspaceId: string; emailKey: string };
export type ReflowEnrollment = {
  id: string;
  workspaceId: string;
  sequenceVersionId: string;
  contactId: string;
  state: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};
export type TriggerWorkflowResult = { contact: ReflowContact; enrollment: ReflowEnrollment };

export class ReflowSdkError extends Error {
  readonly code?: string;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;

  constructor(readonly status: number, message: string, extras?: { code?: string; hint?: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = 'ReflowSdkError';
    if (extras?.code !== undefined) this.code = extras.code;
    if (extras?.hint !== undefined) this.hint = extras.hint;
    if (extras?.details !== undefined) this.details = extras.details;
  }
}

export class ReflowSdk {
  private readonly baseUrl: string;
  private readonly requestFetch: typeof globalThis.fetch;

  constructor(private readonly options: ReflowSdkOptions) {
    if (!options.apiKey && !options.token) throw new Error('Rachet SDK requires apiKey or token');
    this.baseUrl = options.url.replace(/\/$/, '');
    this.requestFetch = options.fetch ?? globalThis.fetch;
  }

  async call<T>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.apiKey) headers['x-api-key'] = this.options.apiKey;
    if (this.options.token) headers.authorization = `Bearer ${this.options.token}`;
    const response = await this.requestFetch(`${this.baseUrl}/v1/operations/${operation}`, {
      method: 'POST', headers, credentials: this.options.credentials ?? 'same-origin', body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => ({ message: response.statusText })) as unknown;
    if (!response.ok) {
      const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
      throw new ReflowSdkError(response.status, typeof record.message === 'string' ? record.message : 'Rachet request failed', {
        ...(typeof record.code === 'string' ? { code: record.code } : {}),
        ...(typeof record.hint === 'string' ? { hint: record.hint } : {}),
        ...(record.details && typeof record.details === 'object' ? { details: record.details as Record<string, unknown> } : {}),
      });
    }
    if (typeof payload === 'object' && payload !== null && 'data' in payload) return payload.data as T;
    return payload as T;
  }

  async trigger(input: TriggerWorkflowInput): Promise<TriggerWorkflowResult> {
    const contact = await this.call<ReflowContact>('contact.upsert', { workspaceId: this.options.workspaceId, ...input.contact });
    const enrollment = await this.call<ReflowEnrollment>('enrollment.create', {
      workspaceId: this.options.workspaceId,
      workflowVersionId: input.workflowVersionId,
      contactId: contact.id,
      variables: input.variables ?? {},
      idempotencyKey: input.idempotencyKey,
    });
    return { contact, enrollment };
  }
}
