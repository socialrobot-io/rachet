import { Ajv, type ErrorObject } from 'ajv';
import { ReflowError } from './errors.js';

const ajv = new Ajv({ allErrors: true, strict: true });

function errors(errors: ErrorObject[] | null | undefined) {
  return (errors ?? []).map(({ instancePath, keyword, message, params }) => ({ instancePath, keyword, message, params }));
}

export function compileEventSchema(eventType: string, schema: Record<string, unknown>) {
  if (schema.type !== 'object') {
    throw new ReflowError('EVENT_SCHEMA_INVALID', `Schema for ${eventType} must describe an object`, 422, false, {
      details: { eventType, error: 'Set schema.type to object' },
    });
  }
  try {
    return ajv.compile(schema);
  } catch (error) {
    throw new ReflowError('EVENT_SCHEMA_INVALID', `Schema for ${eventType} is invalid`, 422, false, {
      details: { eventType, error: error instanceof Error ? error.message : String(error) },
    });
  }
}

export function validateEventData(eventType: string, schema: Record<string, unknown>, data: Record<string, unknown>) {
  const validate = compileEventSchema(eventType, schema);
  if (validate(data)) return;
  throw new ReflowError('EVENT_DATA_INVALID', `Data for ${eventType} does not match its schema`, 422, false, {
    details: { eventType, errors: errors(validate.errors) },
  });
}
