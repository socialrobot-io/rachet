import type { Enrollment, Message, OAuthClient, OAuthConsent, RenderedEmail, SessionUser, Workflow, Workspace } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

async function parseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({ message: response.statusText }));
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/auth${path}`, { credentials: 'include', ...init });
  const payload = await parseJson(response);
  if (!response.ok) {
    const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
    throw new ApiError(response.status, typeof record.error_description === 'string' ? record.error_description : typeof record.message === 'string' ? record.message : 'Authentication request failed');
  }
  return payload as T;
}

function jsonPost(body: Record<string, unknown>): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function oauthRedirect(payload: { url?: string; redirect_uri?: string }): string {
  const target = payload.url ?? payload.redirect_uri;
  if (!target) throw new ApiError(500, 'Authorization server did not return a redirect');
  return target;
}

export async function callOperation<T>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/v1/operations/${operation}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    throw new ApiError(
      response.status,
      typeof record.message === 'string' ? record.message : 'Request failed',
      typeof record.code === 'string' ? record.code : undefined,
    );
  }
  if (typeof payload === 'object' && payload !== null && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export async function getSession(): Promise<SessionUser | null> {
  const response = await fetch('/api/auth/get-session', { credentials: 'include' });
  if (!response.ok) return null;
  const payload = (await parseJson(response)) as { user?: SessionUser } | null;
  return payload?.user ?? null;
}

export async function signIn(email: string, password: string): Promise<SessionUser> {
  const response = await fetch('/api/auth/sign-in/email', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    throw new ApiError(
      response.status,
      typeof record.message === 'string' ? record.message : 'Sign-in failed',
    );
  }
  const user = (payload as { user?: SessionUser }).user;
  if (!user) throw new ApiError(500, 'Sign-in succeeded without a user');
  return user;
}

export async function signOut(): Promise<{ url?: string; redirect?: boolean }> {
  const response = await fetch('/api/auth/sign-out', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
    throw new ApiError(
      response.status,
      typeof record.message === 'string' ? record.message : 'Sign-out failed',
    );
  }
  const result = typeof payload === 'object' && payload !== null
    ? payload as { success?: boolean; url?: string; redirect?: boolean }
    : {};
  if (result.success !== true) throw new ApiError(500, 'Sign-out failed');
  return result;
}

export async function continueOAuth(oauthQuery: string): Promise<string> {
  return oauthRedirect(await authRequest('/oauth2/continue', jsonPost({ selected: true, oauth_query: oauthQuery })));
}

export async function submitOAuthConsent(oauthQuery: string, accept: boolean, scope?: string): Promise<string> {
  return oauthRedirect(await authRequest('/oauth2/consent', jsonPost({ accept, oauth_query: oauthQuery, ...(scope ? { scope } : {}) })));
}

export async function getOAuthClient(clientId: string): Promise<OAuthClient> {
  return authRequest(`/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`);
}

export async function getOAuthConsents(): Promise<OAuthConsent[]> {
  return authRequest('/oauth2/get-consents');
}

export async function revokeOAuthConsent(id: string): Promise<void> {
  const response = await fetch(`/api/connected-apps/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) throw new ApiError(response.status, 'Could not revoke the connected app');
}

export const api = {
  workspaces: () => callOperation<Workspace[]>('workspace.list'),
  workflows: (workspaceId: string) => callOperation<Workflow[]>('workflow.list', { workspaceId }),
  enrollments: (workspaceId: string) => callOperation<Enrollment[]>('enrollment.list', { workspaceId }),
  messages: (workspaceId: string) => callOperation<Message[]>('message.list', { workspaceId }),
  pause: (workspaceId: string, enrollmentId: string) =>
    callOperation('enrollment.pause', { workspaceId, enrollmentId }),
  resume: (workspaceId: string, enrollmentId: string) =>
    callOperation('enrollment.resume', { workspaceId, enrollmentId }),
  cancel: (workspaceId: string, enrollmentId: string) =>
    callOperation('enrollment.cancel', { workspaceId, enrollmentId }),
  renderTemplate: (workspaceId: string, templateVersionId: string, props: Record<string, unknown>) =>
    callOperation<RenderedEmail>('template.render', { workspaceId, templateVersionId, props }),
};
