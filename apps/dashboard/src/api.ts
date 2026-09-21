import type { ApiCredential, CreatedApiCredential, Enrollment, Message, OAuthClient, OAuthConsent, RenderedEmail, ResendConnectionStatus, SessionUser, SetupStatus, Workflow, Workspace } from './types';
import { authClient } from './auth-client';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(status: number, message: string, code?: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (code !== undefined) this.code = code;
    if (fieldErrors !== undefined) this.fieldErrors = fieldErrors;
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

function authError(error: { status: number; message?: string; code?: string }, fallback: string): ApiError {
  return new ApiError(error.status, error.message ?? fallback, error.code);
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
  const { data, error } = await authClient.getSession();
  if (error) return null;
  return data?.user as SessionUser | undefined ?? null;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const response = await fetch('/api/setup/status', { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new ApiError(response.status, 'Could not load setup status');
  return await response.json() as SetupStatus;
}

export async function authorizeRegistration(input: {
  email?: string;
  name: string;
  organizationName: string;
  organizationSlug?: string;
  method: 'magic-link' | 'github';
  setupSecret?: string;
}): Promise<{ intentId?: string }> {
  const response = await fetch('/api/registration/intent', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const rawFieldErrors = record.fieldErrors && typeof record.fieldErrors === 'object'
      ? record.fieldErrors as Record<string, unknown>
      : undefined;
    const fieldErrors = rawFieldErrors
      ? Object.fromEntries(Object.entries(rawFieldErrors).flatMap(([field, messages]) => (
          Array.isArray(messages) && messages.every((message) => typeof message === 'string')
            ? [[field, messages as string[]]]
            : []
        )))
      : undefined;
    throw new ApiError(
      response.status,
      typeof record.message === 'string' ? record.message : 'Registration request failed',
      typeof record.code === 'string' ? record.code : undefined,
      fieldErrors,
    );
  }
  const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
  return typeof record.intentId === 'string' ? { intentId: record.intentId } : {};
}

export async function sendMagicLink(email: string, name: string, callbackURL: string): Promise<void> {
  const { error } = await authClient.signIn.magicLink({
    email,
    name,
    callbackURL,
    errorCallbackURL: callbackURL,
    newUserCallbackURL: callbackURL,
  });
  if (error) throw authError(error, 'Could not send the magic link');
}

export async function signInWithGitHub(callbackURL: string, registrationIntentId?: string): Promise<string> {
  const { data, error } = await authClient.signIn.social({
    provider: 'github',
    callbackURL,
    errorCallbackURL: callbackURL,
    newUserCallbackURL: callbackURL,
    disableRedirect: true,
    requestSignUp: registrationIntentId !== undefined,
    ...(registrationIntentId ? { additionalData: { registrationIntentId } } : {}),
  });
  if (error) throw authError(error, 'Could not start GitHub sign-in');
  if (!data?.url) throw new ApiError(500, 'GitHub sign-in did not return a redirect');
  return data.url;
}

export async function signOut(): Promise<{ url?: string; redirect?: boolean }> {
  const { data, error } = await authClient.signOut();
  if (error) throw authError(error, 'Sign-out failed');
  if (data?.success !== true) throw new ApiError(500, 'Sign-out failed');
  return data;
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

async function integrationRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/integrations/${path}`, { credentials: 'include', cache: 'no-store', ...init });
  const payload = await parseJson(response);
  if (!response.ok) {
    const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
    throw new ApiError(response.status, typeof record.message === 'string' ? record.message : 'Integration request failed');
  }
  return payload as T;
}

export const api = {
  resendConnection: (workspaceId: string) => integrationRequest<ResendConnectionStatus>(`resend?workspaceId=${encodeURIComponent(workspaceId)}`),
  saveResendConnection: (input: { workspaceId: string; from: string; apiKey: string; webhookSecret: string }) =>
    integrationRequest<{ configured: true }>('resend', jsonPost(input)),
  skipResendOnboarding: (workspaceId: string) =>
    integrationRequest<{ onboardingComplete: true }>('resend/skip', jsonPost({ workspaceId })),
  testResendConnection: (workspaceId: string) =>
    integrationRequest<{ accepted: true }>('resend/test', jsonPost({ workspaceId })),
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
  credentials: (workspaceId: string) => callOperation<ApiCredential[]>('credential.list', { workspaceId }),
  createCredential: (workspaceId: string, name: string, scopes: string[], expiresInSeconds: number) =>
    callOperation<CreatedApiCredential>('credential.create', { workspaceId, name, scopes, expiresInSeconds }),
  revokeCredential: (workspaceId: string, keyId: string) =>
    callOperation<{ success: boolean }>('credential.revoke', { workspaceId, keyId }),
};
