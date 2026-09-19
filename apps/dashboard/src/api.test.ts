import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, signOut } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signOut', () => {
  it('uses the Better Auth endpoint with an explicit JSON request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(signOut()).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
  });

  it('does not report success when Better Auth rejects the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Invalid origin' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(signOut()).rejects.toEqual(expect.objectContaining<ApiError>({
      name: 'ApiError',
      status: 403,
      message: 'Invalid origin',
    }));
  });
});
