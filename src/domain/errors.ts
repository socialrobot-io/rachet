export class ReflowError extends Error {
  readonly hint?: string | undefined;
  readonly details?: Record<string, unknown> | undefined;

  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly retryable = false,
    extras?: { hint?: string; details?: Record<string, unknown> },
  ) {
    super(message);
    this.hint = extras?.hint;
    this.details = extras?.details;
  }
}

export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (typeof current === 'object' && current !== null) {
    if ('code' in current && (current as { code: unknown }).code === '23505') return true;
    current = 'cause' in current ? (current as { cause: unknown }).cause : undefined;
  }
  return false;
}

export function errorPayload(error: ReflowError) {
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.hint ? { hint: error.hint } : {}),
    ...(error.details ? { details: error.details } : {}),
  };
}
