import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { Cable, Copy, KeyRound, LogOut, Trash2 } from 'lucide-react';
import { api, authorizeRegistration, continueOAuth, getOAuthClient, getOAuthConsents, getSession, getSetupStatus, revokeOAuthConsent, sendMagicLink, signInWithGitHub, signOut, submitOAuthConsent, ApiError } from '@/api';
import type { ApiCredential, CreatedApiCredential, OAuthClient, OAuthConsent, SessionUser, SetupStatus, Workspace } from '@/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { RachetLogo } from '@/components/RachetLogo';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { normalizeOrganizationSlug, validEmail } from '@/registration-form';

type AuthState = {
  user: SessionUser | null;
  loading: boolean;
  workspaces: Workspace[];
  workspaceId: string | null;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);
const WORKSPACE_KEY = 'reflow.workspaceId';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(
    () => localStorage.getItem(WORKSPACE_KEY),
  );

  const setWorkspaceId = (id: string) => {
    localStorage.setItem(WORKSPACE_KEY, id);
    setWorkspaceIdState(id);
  };

  const refresh = async () => {
    const session = await getSession();
    setUser(session);
    if (!session) {
      setWorkspaces([]);
      setLoading(false);
      return;
    }
    const rows = await api.workspaces();
    setWorkspaces(rows);
    const preferred = localStorage.getItem(WORKSPACE_KEY);
    const next = rows.find((row) => row.id === preferred)?.id ?? rows[0]?.id ?? null;
    if (next) setWorkspaceId(next);
    else setWorkspaceIdState(null);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      workspaces,
      workspaceId,
      logout: async () => {
        const result = await signOut();
        setUser(null);
        setWorkspaces([]);
        setWorkspaceIdState(null);
        localStorage.removeItem(WORKSPACE_KEY);
        if (result.redirect && result.url) window.location.assign(result.url);
      },
      refresh,
    }),
    [user, loading, workspaces, workspaceId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider missing');
  return value;
}

export function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center font-mono text-sm text-muted-foreground">
        Loading session…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function AppShell() {
  const { user, workspaces, workspaceId, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <Link to="/" aria-label="Rachet home"><RachetLogo className="h-7 w-auto" /></Link>
            <nav aria-label="Primary navigation" className="hidden items-center gap-1 md:flex">
              <Link to="/" className="rounded-full px-3 py-1.5 text-sm font-medium hover:bg-accent">Workflows</Link>
              <Link to="/settings/integrations" className="rounded-full px-3 py-1.5 text-sm font-medium hover:bg-accent">Integrations</Link>
              <Link to="/settings/connected-apps" className="rounded-full px-3 py-1.5 text-sm font-medium hover:bg-accent">Connected apps</Link>
              <Link to="/settings/api-keys" className="rounded-full px-3 py-1.5 text-sm font-medium hover:bg-accent">API keys</Link>
            </nav>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden max-w-[12rem] truncate rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold sm:inline">
              {workspaces.find((workspace) => workspace.id === workspaceId)?.name}
            </span>
            <span className="hidden max-w-[14rem] truncate text-xs text-muted-foreground lg:inline">{user?.email}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                setSignOutError(null);
                void logout().catch((reason: unknown) => {
                  setSignOutError(reason instanceof Error ? reason.message : 'Sign-out failed');
                  setSigningOut(false);
                });
              }}
            >
              <LogOut data-icon="inline-start" />
              <span className="sr-only sm:not-sr-only">{signingOut ? 'Signing out…' : 'Sign out'}</span>
            </Button>
          </div>
          <nav aria-label="Mobile navigation" className="flex w-full items-center gap-1 overflow-x-auto pb-1 md:hidden">
            <Link to="/" className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-accent">Workflows</Link>
            <Link to="/settings/integrations" className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-accent">Integrations</Link>
            <Link to="/settings/connected-apps" className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-accent">Apps</Link>
            <Link to="/settings/api-keys" className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium hover:bg-accent">API keys</Link>
          </nav>
        </div>
      </header>
      {signOutError && (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
          <Alert variant="destructive">
            <AlertDescription>{signOutError}</AlertDescription>
          </Alert>
        </div>
      )}
      <Outlet />
    </div>
  );
}

export function LoginPage() {
  const { user, loading, workspaceId, workspaces } = useAuth();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [organizationSlug, setOrganizationSlug] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oauthQuery = searchParams.get('oauth_query')
    ?? (searchParams.has('client_id') ? searchParams.toString() : null);

  const finishLogin = useCallback(async () => {
    if (oauthQuery) {
      const role = workspaces.find((workspace) => workspace.id === workspaceId)?.role;
      if (workspaceId && (role === 'owner' || role === 'admin')) {
        const connection = await api.resendConnection(workspaceId);
        if (!connection.onboardingComplete) {
          navigate(`/onboarding/integrations?oauth_query=${encodeURIComponent(oauthQuery)}`, { replace: true });
          return;
        }
      }
      window.location.assign(await continueOAuth(oauthQuery));
      return;
    }
    navigate('/', { replace: true });
  }, [navigate, oauthQuery, workspaceId, workspaces]);

  useEffect(() => {
    if (!loading && user) void finishLogin().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not finish sign-in');
    });
  }, [loading, user, finishLogin]);

  useEffect(() => {
    void getSetupStatus().then(setStatus).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not load registration status');
    });
  }, []);

  const callbackURL = `/auth/login${oauthQuery ? `?oauth_query=${encodeURIComponent(oauthQuery)}` : ''}`;

  const begin = async (method: 'magic-link' | 'github') => {
    if (!status) return;
    if ((method === 'magic-link' && !status.methods.magicLink) || (method === 'github' && !status.methods.github)) return;
    const nextFieldErrors: Record<string, string> = {};
    if (status.requiresSetup && !name.trim()) nextFieldErrors.name = 'Enter your name.';
    if (status.requiresSetup && !organizationName.trim()) nextFieldErrors.organizationName = 'Enter an organization name.';
    if (status.requiresSetup && !setupSecret) nextFieldErrors.setupSecret = 'Enter the setup secret.';
    if (method === 'magic-link' && !validEmail(email)) nextFieldErrors.email = 'Enter a valid email address.';
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setError(null);
      return;
    }
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const shouldAuthorizeRegistration = method === 'magic-link' || status.requiresSetup || status.registrationEnabled;
      const registration = shouldAuthorizeRegistration
        ? await authorizeRegistration({
            ...(method === 'magic-link' ? { email: email.trim() } : {}),
            name: name.trim() || (method === 'magic-link' ? email.split('@')[0] : 'GitHub user') || 'Rachet user',
            organizationName: organizationName.trim() || 'My organization',
            ...(organizationSlug.trim() ? { organizationSlug: organizationSlug.trim() } : {}),
            method,
            ...(status.requiresSetup ? { setupSecret } : {}),
          })
        : {};
      if (method === 'magic-link') {
        await sendMagicLink(email.trim(), name.trim(), callbackURL);
        setSent(true);
      } else {
        window.location.assign(await signInWithGitHub(callbackURL, registration.intentId));
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.fieldErrors) {
        setFieldErrors(Object.fromEntries(
          Object.entries(reason.fieldErrors).flatMap(([field, messages]) => (
            messages[0] ? [[field, messages[0]]] : []
          )),
        ));
        setError(null);
      } else {
        setError(reason instanceof ApiError ? reason.message : 'Sign-in failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const method = submitter instanceof HTMLButtonElement && submitter.value === 'github'
      ? 'github'
      : 'magic-link';
    void begin(method);
  };

  if (loading || (!status && !error)) {
    return (
      <div className="flex min-h-dvh items-center justify-center font-mono text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-md border-border/80 shadow-[0_1px_0_rgb(0_0_0/0.03),0_18px_40px_rgb(15_25_35/0.06)]">
        <CardHeader className="flex flex-col gap-1.5">
          <CardTitle><RachetLogo className="h-9 w-auto" /></CardTitle>
          <CardDescription>
            {status?.requiresSetup
              ? 'Create the first administrator and the deployment’s organization.'
              : 'Sign in securely with a magic link or GitHub.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {sent && (
              <Alert>
                <AlertDescription>If the address is eligible, a single-use sign-in link is on its way. It expires in 10 minutes.</AlertDescription>
              </Alert>
            )}
            <FieldGroup>
              {status?.requiresSetup && (
                <>
                  <Field data-invalid={Boolean(fieldErrors.name)}>
                    <FieldLabel htmlFor="name">Your name</FieldLabel>
                    <Input id="name" autoComplete="name" value={name} aria-invalid={Boolean(fieldErrors.name)} onChange={(event) => { setName(event.target.value); setFieldErrors((current) => ({ ...current, name: '' })); }} />
                    <FieldError>{fieldErrors.name}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(fieldErrors.organizationName)}>
                    <FieldLabel htmlFor="organization">Organization name</FieldLabel>
                    <Input id="organization" value={organizationName} aria-invalid={Boolean(fieldErrors.organizationName)} onChange={(event) => { setOrganizationName(event.target.value); setFieldErrors((current) => ({ ...current, organizationName: '' })); }} />
                    <FieldError>{fieldErrors.organizationName}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(fieldErrors.organizationSlug)}>
                    <FieldLabel htmlFor="organization-slug">Organization slug <span className="text-muted-foreground">(optional)</span></FieldLabel>
                    <Input
                      id="organization-slug"
                      placeholder="acme"
                      value={organizationSlug}
                      aria-invalid={Boolean(fieldErrors.organizationSlug)}
                      onChange={(event) => {
                        setOrganizationSlug(normalizeOrganizationSlug(event.target.value));
                        setFieldErrors((current) => ({ ...current, organizationSlug: '' }));
                      }}
                    />
                    <FieldDescription>Lowercase letters, numbers, and hyphens. Dots become hyphens.</FieldDescription>
                    <FieldError>{fieldErrors.organizationSlug}</FieldError>
                  </Field>
                  <Field data-invalid={Boolean(fieldErrors.setupSecret)}>
                    <FieldLabel htmlFor="setup-secret">Setup secret</FieldLabel>
                    <Input id="setup-secret" type="password" autoComplete="off" value={setupSecret} aria-invalid={Boolean(fieldErrors.setupSecret)} onChange={(event) => { setSetupSecret(event.target.value); setFieldErrors((current) => ({ ...current, setupSecret: '' })); }} />
                    <FieldError>{fieldErrors.setupSecret}</FieldError>
                  </Field>
                </>
              )}
              {status?.methods.magicLink && (
                <Field data-invalid={Boolean(fieldErrors.email)}>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    aria-invalid={Boolean(fieldErrors.email)}
                    onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: '' })); }}
                  />
                  {status.methods.github && <FieldDescription>Only required when continuing with a magic link.</FieldDescription>}
                  <FieldError>{fieldErrors.email}</FieldError>
                </Field>
              )}
            </FieldGroup>
            {status?.methods.magicLink && (
              <Button type="submit" name="method" value="magic-link" className="w-full" disabled={submitting || sent}>
                <KeyRound data-icon="inline-start" />
                {submitting ? 'Sending…' : sent ? 'Link sent' : 'Continue with magic link'}
              </Button>
            )}
            {status?.methods.github && (
              <Button type="submit" name="method" value="github" variant="outline" className="w-full" disabled={submitting}>
                Continue with GitHub
              </Button>
            )}
            {status && !status.methods.magicLink && !status.methods.github && !status.magicLinkConfigurationWarning && (
              <Alert variant="destructive"><AlertDescription>No sign-in method is configured. Ask the deployment operator to configure auth email or GitHub.</AlertDescription></Alert>
            )}
            {status?.magicLinkConfigurationWarning && (
              <Alert variant="destructive"><AlertDescription>{status.magicLinkConfigurationWarning}</AlertDescription></Alert>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function ConsentPage() {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const clientId = searchParams.get('client_id');
  const requestedScope = searchParams.get('scope') ?? '';
  const oauthQuery = searchParams.get('oauth_query') ?? searchParams.toString();
  const [client, setClient] = useState<OAuthClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate(`/auth/login?oauth_query=${encodeURIComponent(oauthQuery)}`, { replace: true });
      return;
    }
    if (!clientId) {
      setError('The authorization request is missing a client identifier.');
      return;
    }
    void getOAuthClient(clientId).then(setClient).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not load the requesting client');
    });
  }, [loading, user, clientId, oauthQuery, navigate]);

  const decide = async (accept: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      window.location.assign(await submitOAuthConsent(oauthQuery, accept, accept ? requestedScope : undefined));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authorization failed');
      setSubmitting(false);
    }
  };

  const scopes = requestedScope.split(' ').filter(Boolean);
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Authorize {client?.client_name ?? 'this app'}</CardTitle>
          <CardDescription>
            Review the access requested for your Rachet account. You can revoke it later under Connected apps.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-2">
            {scopes.map((scope) => (
              <div key={scope} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Cable className="size-4 text-muted-foreground" />
                <code>{scope}</code>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={submitting} onClick={() => void decide(false)}>Deny</Button>
            <Button type="button" disabled={submitting || !client} onClick={() => void decide(true)}>Authorize</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

type ConnectedAuthorization = { consent: OAuthConsent; client: OAuthClient | null };

export function ConnectedAppsPage() {
  const [items, setItems] = useState<ConnectedAuthorization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const consents = await getOAuthConsents();
      const connected = await Promise.all(consents.map(async (consent) => ({
        consent,
        client: await getOAuthClient(consent.clientId).catch(() => null),
      })));
      setItems(connected);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load connected apps');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Connected apps</h1>
        <p className="mt-1 text-sm text-muted-foreground">CLI and MCP clients authorized to access Rachet on your behalf.</p>
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {loading ? <p className="text-sm text-muted-foreground">Loading connected apps…</p> : items.length === 0 ? (
        <Card><CardContent className="py-10 text-sm text-muted-foreground">No connected apps.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map(({ consent, client }) => (
            <Card key={consent.id}>
              <CardContent className="flex items-start justify-between gap-4 py-5">
                <div>
                  <p className="font-medium">{client?.client_name ?? consent.clientId}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{consent.scopes.join(' · ')}</p>
                </div>
                <Button type="button" variant="outline" onClick={() => void revokeOAuthConsent(consent.id).then(refresh)}>Revoke</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const CREDENTIAL_SCOPES = ['read', 'write', 'send'] as const;

function formatDate(value: string | null): string {
  if (!value) return 'never';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function ApiKeysPage() {
  const { workspaceId } = useAuth();
  const [items, setItems] = useState<ApiCredential[]>([]);
  const [name, setName] = useState('SDK key');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [created, setCreated] = useState<CreatedApiCredential | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      setItems(await api.credentials(workspaceId));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load API keys');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!workspaceId || scopes.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      setCreated(await api.createCredential(workspaceId, name, scopes, expiresInDays * 24 * 60 * 60));
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create API key');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">Create scoped credentials for the SDK. Keys are fixed to this organization.</p>
      </div>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      {created && (
        <Alert className="mb-6">
          <AlertDescription className="space-y-3">
            <p><strong>Copy this key now.</strong> It cannot be shown again.</p>
            <div className="flex gap-2">
              <Input readOnly value={created.key} className="font-mono" aria-label="New API key" />
              <Button type="button" variant="outline" aria-label="Copy API key" onClick={() => void navigator.clipboard.writeText(created.key)}><Copy /></Button>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setCreated(null)}>I saved it</Button>
          </AlertDescription>
        </Alert>
      )}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Create API key</CardTitle>
          <CardDescription>Use the least privilege and shortest lifetime your integration needs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="key-name">Name</Label><Input id="key-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={64} /></div>
            <div className="space-y-2"><Label htmlFor="key-expiry">Expires in days</Label><Input id="key-expiry" type="number" min={1} max={365} value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))} /></div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Scopes</legend>
            <div className="flex flex-wrap gap-4">
              {CREDENTIAL_SCOPES.map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={scopes.includes(scope)} onChange={(event) => setScopes((current) => event.target.checked ? [...new Set([...current, scope])] : current.filter((value) => value !== scope))} />
                  {scope}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="button" disabled={submitting || !name.trim() || scopes.length === 0 || expiresInDays < 1 || expiresInDays > 365} onClick={() => void create()}>
            <KeyRound data-icon="inline-start" />{submitting ? 'Creating…' : 'Create key'}
          </Button>
        </CardContent>
      </Card>
      {loading ? <p className="text-sm text-muted-foreground">Loading API keys…</p> : items.length === 0 ? (
        <Card><CardContent className="py-10 text-sm text-muted-foreground">No API keys.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex items-start justify-between gap-4 py-5">
                <div className="min-w-0">
                  <p className="font-medium">{item.name ?? 'Unnamed key'}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">{item.start ?? `${item.prefix ?? 'rf'}_••••`}…</p>
                  <p className="mt-2 text-xs text-muted-foreground">{item.scopes.join(' · ')} · expires {formatDate(item.expiresAt)} · last used {formatDate(item.lastRequest)}</p>
                </div>
                <Button type="button" variant="outline" disabled={!item.enabled} onClick={() => {
                  if (!workspaceId || !window.confirm(`Revoke ${item.name ?? 'this API key'}?`)) return;
                  void api.revokeCredential(workspaceId, item.id).then(refresh).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not revoke API key'));
                }}><Trash2 data-icon="inline-start" />Revoke</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
