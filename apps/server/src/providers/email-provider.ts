export type FrozenMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  tags?: Array<{ name: string; value: string }>;
};

export type SendOutcome =
  | { kind: 'accepted'; messageId: string }
  | { kind: 'rejected'; code: string; retryable: boolean }
  | { kind: 'unknown'; code: string };

export interface EmailProvider {
  send(message: FrozenMessage, idempotencyKey: string): Promise<SendOutcome>;
  verifyWebhook(raw: string, headers: Headers): Promise<Record<string, unknown>>;
}
