import { SESv2Client, SESv2ServiceException, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { formatMailbox } from '../domain/email-policy.js';
import type { EmailProvider, FrozenMessage, SendOutcome } from './email-provider.js';

export type SesCredentials = { accessKeyId: string; secretAccessKey: string };

function encodeHeader(value: string) {
  if (/^[ -~]*$/.test(value)) return value;
  const words: string[] = [];
  let chunk = '';
  for (const character of value) {
    if (Buffer.byteLength(chunk + character) > 42) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`);
  return words.join(' ');
}

function encodeSender(from: string) {
  const bracket = from.lastIndexOf('<');
  if (bracket < 0) return from;
  const name = from.slice(0, bracket).trim();
  const displayName = name.startsWith('"') && name.endsWith('"') ? name.slice(1, -1).replace(/\\(["\\])/g, '$1') : name;
  if (/^[ -~]*$/.test(displayName)) return formatMailbox(displayName, from.slice(bracket + 1, -1));
  return `${encodeHeader(displayName)} ${from.slice(bracket)}`;
}

export class SesProvider implements EmailProvider {
  readonly #client: SESv2Client;

  constructor(region: string, private readonly configurationSet: string, credentials: SesCredentials) {
    // SES may accept a message before returning a timeout or server error.
    this.#client = new SESv2Client({ region, credentials, maxAttempts: 1, ignoreConfiguredEndpointUrls: true });
  }

  async send(message: FrozenMessage): Promise<SendOutcome> {
    const headers = Object.entries(message.headers ?? {});
    if ([message.from, message.to, message.subject, ...headers.flat()].some((value) => /[\r\n\0]/.test(value))) {
      return { kind: 'rejected', code: 'invalid_email_header', retryable: false };
    }
    try {
      const result = await this.#client.send(new SendEmailCommand({
        FromEmailAddress: encodeSender(message.from),
        Destination: { ToAddresses: [message.to] },
        ConfigurationSetName: this.configurationSet,
        EmailTags: message.tags?.map(({ name, value }) => ({ Name: name, Value: value })),
        Content: {
          Simple: {
            Subject: { Data: encodeHeader(message.subject), Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              Text: { Data: message.text, Charset: 'UTF-8' },
            },
            Headers: headers.map(([Name, Value]) => ({ Name, Value })),
          },
        },
      }), { abortSignal: AbortSignal.timeout(15_000) });
      return result.MessageId
        ? { kind: 'accepted', messageId: result.MessageId }
        : { kind: 'unknown', code: 'ses_missing_message_id' };
    } catch (error) {
      if (error instanceof SESv2ServiceException) {
        const status = error.$metadata.httpStatusCode ?? 0;
        if (status >= 400 && status < 500 && status !== 408) {
          return { kind: 'rejected', code: error.name, retryable: status === 429 && error.name === 'TooManyRequestsException' };
        }
      }
      return { kind: 'unknown', code: 'ses_acceptance_unknown' };
    } finally {
      this.#client.destroy();
    }
  }
}
