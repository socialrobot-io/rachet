import { describe, expect, it } from 'vitest';
import { compileEventSchema, validateEventData } from '../apps/server/src/domain/event-types.js';

const schema = {
  type: 'object',
  required: ['plan'],
  properties: { plan: { type: 'string', enum: ['free', 'pro'] } },
  additionalProperties: false,
};

describe('event type schemas', () => {
  it('accepts a valid object schema and matching data', () => {
    expect(() => compileEventSchema('product.activated.v1', schema)).not.toThrow();
    expect(() => validateEventData('product.activated.v1', schema, { plan: 'pro' })).not.toThrow();
  });

  it('rejects schemas without an object root and data that misses the schema', () => {
    expect(() => compileEventSchema('product.activated.v1', { type: 'string' })).toThrow('must describe an object');
    expect(() => validateEventData('product.activated.v1', schema, { plan: 'enterprise' })).toThrow('does not match its schema');
  });
});
