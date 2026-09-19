import type { EmailProvider, FrozenMessage, SendOutcome } from '../../apps/server/src/providers/email-provider.js';

/** Deterministic provider for activity/integration tests. */
export class FakeEmailProvider implements EmailProvider {
  readonly sent: Array<{ message: FrozenMessage; idempotencyKey: string }> = [];
  nextOutcome: SendOutcome = { kind: 'accepted', messageId: 'msg_fake_1' };

  async send(message: FrozenMessage, idempotencyKey: string): Promise<SendOutcome> {
    this.sent.push({ message, idempotencyKey });
    return this.nextOutcome;
  }

  async verifyWebhook(): Promise<Record<string, unknown>> {
    return { ok: true };
  }
}
