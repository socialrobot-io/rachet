import { describe, expect, it } from 'vitest';
import { createOperations } from '../apps/server/src/operations.js';
import type { ReflowService } from '../apps/server/src/domain/service.js';
import { workflowDefinitionSchema } from '../packages/contracts/src/index.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const definition = {
  schemaVersion: '1',
  description: 'Send once at a local clock time',
  trigger: { type: 'schedule', at: '2026-07-01T09:00:00+02:00', timeZone: 'Europe/Amsterdam' },
  entryNodeId: 'done',
  nodes: [{ id: 'done', type: 'end', reason: 'done' }],
};

describe('CLI and MCP operation timezone contract', () => {
  const operations = createOperations({} as ReflowService);

  it.each(['workflow.create', 'workflow.validate', 'workflow.simulate'])('%s rejects a naive or mismatched schedule', (name) => {
    const input = { workspaceId, definition, ...(name === 'workflow.create' ? { name: 'Scheduled', intent: 'Send at 9am' } : {}) };
    expect(operations[name]?.input.safeParse(input).success).toBe(true);
    expect(operations[name]?.input.safeParse({ ...input, definition: { ...definition, trigger: { ...definition.trigger, at: '2026-07-01T09:00:00' } } }).success).toBe(false);
    expect(operations[name]?.input.safeParse({ ...input, definition: { ...definition, trigger: { ...definition.trigger, at: '2026-07-01T09:00:00+01:00' } } }).success).toBe(false);
    expect(operations[name]?.input.safeParse({ ...input, definition: { ...definition, trigger: { type: 'schedule', at: '2026-07-01T09:00:00+02:00' } } }).success).toBe(false);
  });

  it('rejects invalid contact timezones at the same operation boundary', () => {
    const input = { workspaceId, email: 'a@example.com', timezone: 'UTC+02:00' };
    expect(operations['contact.upsert']?.input.safeParse(input).success).toBe(false);
    expect(operations['contact.upsert']?.input.safeParse({ ...input, timezone: 'Europe/Amsterdam' }).success).toBe(true);
  });

  it('advertises required schedule fields in the MCP workflow JSON schema', () => {
    const schema = workflowDefinitionSchema.toJSONSchema() as { properties: { trigger: { oneOf: Array<{ properties: { type: { const: string } }; required: string[] }> } } };
    const schedule = schema.properties.trigger.oneOf.find((item) => item.properties.type.const === 'schedule');
    expect(schedule?.required).toEqual(expect.arrayContaining(['at', 'timeZone']));
  });
});
