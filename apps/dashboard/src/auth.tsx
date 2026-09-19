import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { Cable, LogOut } from 'lucide-react';
import { api, continueOAuth, getOAuthClient, getOAuthConsents, getSession, revokeOAuthConsent, signIn, signOut, submitOAuthConsent, ApiError } from '@/api';
import type { OAuthClient, OAuthConsent, SessionUser, Workspace } from '@/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

type AuthState = {
  user: SessionUser | null;
  loading: boolean;
  workspaces: Workspace[];
  workspaceId: string | null;
  setWorkspaceId: (id: string) => void;
  login: (email: string, password: string) => Promise<void>;
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
      setWorkspaceId,
      login: async (email, password) => {
        await signIn(email, password);
        setLoading(true);
        await refresh();
      },
      logout: async () => {
        await signOut();
        setUser(null);
        setWorkspaces([]);
        setWorkspaceIdState(null);
        localStorage.removeItem(WORKSPACE_KEY);
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
  const { user, workspaces, workspaceId, setWorkspaceId, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="text-[1.05rem] font-semibold tracking-tight">
            Reflow
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link to="/settings/connected-apps" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline-flex">
              Connected apps
            </Link>
            {workspaces.length > 0 && (
              <Select
                value={workspaceId ?? undefined}
                onValueChange={(value) => {
                  if (!value) return;
                  setWorkspaceId(value);
                  navigate('/');
                }}
              >
                <SelectTrigger className="h-8 w-[10.5rem] sm:w-44" aria-label="Workspace">
                  <SelectValue placeholder="Workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Separator orientation="vertical" className="hidden h-5 sm:block" />
            <span className="hidden max-w-[14rem] truncate text-sm text-muted-foreground sm:inline">
              {user?.email}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void logout().then(() => navigate('/login'))}
            >
              <LogOut data-icon="inline-start" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oauthQuery = searchParams.get('oauth_query')
    ?? (searchParams.has('client_id') ? searchParams.toString() : null);

  const finishLogin = useCallback(async () => {
    if (oauthQuery) {
      window.location.assign(await continueOAuth(oauthQuery));
      return;
    }
    navigate('/', { replace: true });
  }, [navigate, oauthQuery]);

  useEffect(() => {
    if (!loading && user) void finishLogin();
  }, [loading, user, finishLogin]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center font-mono text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-md border-border/80 shadow-[0_1px_0_rgb(0_0_0/0.03),0_18px_40px_rgb(15_25_35/0.06)]">
        <CardHeader className="space-y-1.5">
          <CardTitle className="text-2xl tracking-tight">Reflow</CardTitle>
          <CardDescription>
            Sign in to the workflow operations console with your email and password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitting(true);
              setError(null);
              void login(email, password)
                .then(finishLogin)
                .catch((err: unknown) => {
                  setError(err instanceof ApiError ? err.message : 'Sign-in failed');
                })
                .finally(() => setSubmitting(false));
            }}
          >
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
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
            Review the access requested for your Reflow account. You can revoke it later under Connected apps.
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
        <p className="mt-1 text-sm text-muted-foreground">CLI and MCP clients authorized to access Reflow on your behalf.</p>
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
