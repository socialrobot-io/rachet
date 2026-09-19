import { Resend } from 'resend';
import type { EmailProvider, FrozenMessage, SendOutcome } from './email-provider.js';

export class ResendProvider implements EmailProvider {
  readonly #client: Resend;

  constructor(apiKey: string, private readonly webhookSecret: string | undefined) {
    this.#client = new Resend(apiKey);
  }

  async send(message: FrozenMessage, idempotencyKey: string): Promise<SendOutcome> {
    try {
      const { data, error } = await this.#client.emails.send(message, { idempotencyKey });
      if (!error && data) return { kind: 'accepted', messageId: data.id };
      const status = 'statusCode' in (error ?? {}) ? Number(error?.statusCode) : 0;
      const code = error?.name ?? 'resend_error';
      return { kind: 'rejected', code, retryable: status === 429 || status >= 500 };
    } catch (error) {
      return { kind: 'unknown', code: error instanceof Error ? error.name : 'transport_error' };
    }
  }

  async verifyWebhook(raw: string, headers: Headers): Promise<Record<string, unknown>> {
    if (!this.webhookSecret) throw new Error('Resend webhook secret is not configured');
    const result = this.#client.webhooks.verify({
      payload: raw,
      headers: {
        id: headers.get('svix-id') ?? '',
        timestamp: headers.get('svix-timestamp') ?? '',
        signature: headers.get('svix-signature') ?? '',
      },
      webhookSecret: this.webhookSecret,
    });
    return await Promise.resolve(result as unknown as Record<string, unknown>);
  }
}
