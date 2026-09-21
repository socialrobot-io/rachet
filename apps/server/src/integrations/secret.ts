import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { Config } from '../config.js';

function keyFromConfig(config: Config): Buffer {
  if (!config.integrationEncryptionKey) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY is required for workspace integrations');
  }
  const key = Buffer.from(config.integrationEncryptionKey, 'base64');
  if (key.length !== 32) throw new Error('Invalid integration encryption key');
  return key;
}

export function encryptIntegrationSecret(config: Config, workspaceId: string, purpose: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromConfig(config), iv);
  cipher.setAAD(Buffer.from(`${workspaceId}:${purpose}`));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptIntegrationSecret(config: Config, workspaceId: string, purpose: string, encrypted: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = encrypted.split(':');
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedCiphertext) throw new Error('Invalid encrypted integration secret');
  const decipher = createDecipheriv('aes-256-gcm', keyFromConfig(config), Buffer.from(encodedIv, 'base64url'));
  decipher.setAAD(Buffer.from(`${workspaceId}:${purpose}`));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function fingerprintIntegrationSecret(config: Config, purpose: string, value: string): string {
  return createHmac('sha256', keyFromConfig(config)).update(`${purpose}:${value}`).digest('hex');
}
