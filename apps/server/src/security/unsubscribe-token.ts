import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';

const keyId = (key: string) => createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 12);
const signature = (key: string, id: string) => createHmac('sha256', Buffer.from(key, 'base64')).update(`unsubscribe:v1:${id}`).digest('base64url');
export const tokenDigest = (token: string) => createHash('sha256').update(token).digest('hex');

export function createUnsubscribeToken(config: Config) {
  const key = config.unsubscribeSigningKeys[0];
  if (!key) throw new Error('UNSUBSCRIBE_SIGNING_KEYS is required for marketing email');
  const id = randomUUID();
  const token = `${keyId(key)}.${id}.${signature(key, id)}`;
  return { id, token, digest: tokenDigest(token) };
}

export function validUnsubscribeToken(config: Config, token: string): boolean {
  const parts = token.split('.');
  const [version, id, mac] = parts;
  if (parts.length !== 3 || !/^[a-f0-9]{12}$/.test(version ?? '') || !/^[0-9a-f-]{36}$/.test(id ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(mac ?? '')) return false;
  const key = config.unsubscribeSigningKeys.find((candidate) => keyId(candidate) === version);
  if (!key) return false;
  return timingSafeEqual(Buffer.from(mac ?? ''), Buffer.from(signature(key, id ?? '')));
}
