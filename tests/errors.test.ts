import { describe, expect, it } from 'vitest';
import { ReflowError, errorPayload, isUniqueViolation } from '../apps/server/src/domain/errors.js';

describe('ReflowError', () => {
  it('serializes hint and details when present', () => {
    const error = new ReflowError('TEMPLATE_IN_USE', 'Cannot archive', 409, false, {
      hint: 'Unpin first',
      details: { templateId: 't1' },
    });
    expect(errorPayload(error)).toEqual({
      code: 'TEMPLATE_IN_USE',
      message: 'Cannot archive',
      retryable: false,
      hint: 'Unpin first',
      details: { templateId: 't1' },
    });
  });

  it('omits optional fields when unset', () => {
    expect(errorPayload(new ReflowError('NOT_FOUND', 'Missing', 404))).toEqual({
      code: 'NOT_FOUND',
      message: 'Missing',
      retryable: false,
    });
  });
});

describe('isUniqueViolation', () => {
  it('detects Postgres unique violations, including nested Drizzle causes', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '42P01' })).toBe(false);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
    expect(isUniqueViolation({ message: 'Failed query', cause: { code: '23505' } })).toBe(true);
  });
});
