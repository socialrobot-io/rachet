import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, authorizeRegistration, signOut } from './api';

const signOutMock = vi.hoisted(() => vi.fn());

vi.mock('./auth-client', () => ({
  authClient: { signOut: signOutMock },
}));

afterEach(() => {
  signOutMock.mockReset();
  vi.unstubAllGlobals();
});

describe('registration validation', () => {
  it('preserves server field errors for accessible form feedback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'VALIDATION_FAILED',
      message: 'Check the highlighted fields and try again.',
      fieldErrors: { organizationSlug: ['Use lowercase letters, numbers, and hyphens only.'] },
    }), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(authorizeRegistration({
      method: 'github',
      name: 'Nicolas',
      organizationName: 'Wololo',
      organizationSlug: 'bedtimefable.ai',
    })).rejects.toEqual(expect.objectContaining<ApiError>({
      name: 'ApiError',
      status: 422,
      message: 'Check the highlighted fields and try again.',
      code: 'VALIDATION_FAILED',
      fieldErrors: { organizationSlug: ['Use lowercase letters, numbers, and hyphens only.'] },
    }));
  });
});

describe('signOut', () => {
  it('uses the Better Auth client', async () => {
    signOutMock.mockResolvedValue({ data: { success: true }, error: null });

    await expect(signOut()).resolves.toEqual({ success: true });
    expect(signOutMock).toHaveBeenCalledOnce();
  });

  it('does not report success when Better Auth rejects the request', async () => {
    signOutMock.mockResolvedValue({
      data: null,
      error: { status: 403, message: 'Invalid origin', code: 'INVALID_ORIGIN' },
    });

    await expect(signOut()).rejects.toEqual(expect.objectContaining<ApiError>({
      name: 'ApiError',
      status: 403,
      message: 'Invalid origin',
    }));
  });
});
