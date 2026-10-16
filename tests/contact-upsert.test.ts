import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workspaces } from '../apps/server/src/db/schema.js';
import { adminContext, probeDbRuntime, type DbRuntime } from './helpers/db-runtime.js';

const runtime = await probeDbRuntime();

describe.skipIf(!runtime)('contact.upsert merges fields (postgres)', () => {
  const boot = runtime as DbRuntime;
  const admin = adminContext('contact-upsert');
  let workspaceId = '';

  beforeAll(async () => {
    const slug = `upsert-${crypto.randomUUID().slice(0, 8)}`;
    const [workspace] = await boot.db.insert(workspaces).values({ name: `Upsert ${slug}`, slug }).returning();
    if (!workspace) throw new Error('workspace create failed');
    workspaceId = workspace.id;
  });

  afterAll(async () => {
    await boot.close();
  });

  const email = () => `upsert-${crypto.randomUUID().slice(0, 8)}@example.com`;

  it('keeps fields another caller set and replaces only the keys sent', async () => {
    const address = email();
    await boot.service.contactUpsert(admin, { workspaceId, email: address, fields: { firstName: 'Ada', plan: 'free' } });
    const row = await boot.service.contactUpsert(admin, { workspaceId, email: address, fields: { plan: 'pro', projectName: 'Acme' } });
    expect(row.fields).toEqual({ firstName: 'Ada', plan: 'pro', projectName: 'Acme' });
  });

  it('keeps every field when fields are left out', async () => {
    const address = email();
    await boot.service.contactUpsert(admin, { workspaceId, email: address, timezone: 'Europe/Madrid', fields: { locale: 'es' } });
    const row = await boot.service.contactUpsert(admin, { workspaceId, email: address });
    expect(row.fields).toEqual({ locale: 'es' });
    expect(row.timezone).toBe('Europe/Madrid');
  });

  it('removes a key sent as null', async () => {
    const address = email();
    await boot.service.contactUpsert(admin, { workspaceId, email: address, fields: { locale: 'en', testRecipient: true } });
    const row = await boot.service.contactUpsert(admin, { workspaceId, email: address, fields: { testRecipient: null } });
    expect(row.fields).toEqual({ locale: 'en' });
  });

  it('does not store null keys on a new contact', async () => {
    const row = await boot.service.contactUpsert(admin, { workspaceId, email: email(), fields: { firstName: 'Sam', plan: null } });
    expect(row.fields).toEqual({ firstName: 'Sam' });
  });

  it('matches the address case-insensitively', async () => {
    const address = email();
    await boot.service.contactUpsert(admin, { workspaceId, email: address, fields: { firstName: 'Lin' } });
    const row = await boot.service.contactUpsert(admin, { workspaceId, email: address.toUpperCase(), fields: { plan: 'starter' } });
    expect(row.fields).toEqual({ firstName: 'Lin', plan: 'starter' });
  });
});
