import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/api';
import { useAuth } from '@/auth';
import type { ResendConnectionStatus } from '@/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export function RequireResendOnboarding() {
  const { workspaceId, workspaces } = useAuth();
  const [result, setResult] = useState<{ workspaceId: string; status: ResendConnectionStatus } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void api.resendConnection(workspaceId).then((status) => {
      if (active) setResult({ workspaceId, status });
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load integration setup');
    });
    return () => { active = false; };
  }, [workspaceId]);

  if (!workspaceId) return <Alert><AlertDescription>No organization is assigned to this account.</AlertDescription></Alert>;
  if (error) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>;
  if (!result || result.workspaceId !== workspaceId) return <div className="p-8 text-sm text-muted-foreground">Loading organization setup…</div>;
  const role = workspaces.find((workspace) => workspace.id === workspaceId)?.role;
  if (!result.status.onboardingComplete && (role === 'owner' || role === 'admin')) {
    return <Navigate to="/onboarding/integrations" replace />;
  }
  return <Outlet />;
}

export function IntegrationsPage({ onboarding = false }: { onboarding?: boolean }) {
  const { workspaceId, workspaces } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oauthQuery = searchParams.get('oauth_query');
  const suffix = oauthQuery ? `?oauth_query=${encodeURIComponent(oauthQuery)}` : '';
  const [status, setStatus] = useState<ResendConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const role = workspaces.find((workspace) => workspace.id === workspaceId)?.role;
  const canManage = role === 'owner' || role === 'admin';

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void api.resendConnection(workspaceId).then((next) => { if (active) setStatus(next); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load integrations'); });
    return () => { active = false; };
  }, [workspaceId]);

  async function skip() {
    if (!workspaceId) return;
    setSaving(true);
    setError(null);
    try {
      await api.skipResendOnboarding(workspaceId);
      navigate(oauthQuery ? `/auth/login?oauth_query=${encodeURIComponent(oauthQuery)}` : '/', { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not continue');
    } finally { setSaving(false); }
  }

  return <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
    <div>
      <p className="text-sm font-medium text-muted-foreground">{onboarding ? 'First steps' : 'Organization settings'}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Integrations</h1>
      <p className="mt-2 text-muted-foreground">Connect the services your workflows use. Each organization manages its own credentials.</p>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="grid gap-4 sm:grid-cols-3">
      <Card><CardHeader><CardTitle>Resend</CardTitle><CardDescription>Send email and receive delivery events with your own Resend account.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{status?.lastTestAcceptedAt ? 'Connected and tested' : status?.configured ? 'Configured · test required' : 'Not connected'}</p>
        <Button asChild variant="outline"><Link to={`${onboarding ? '/onboarding/integrations/resend' : '/settings/integrations/resend'}${suffix}`}>{status?.configured ? 'Manage Resend' : 'Connect Resend'}</Link></Button>
      </CardContent></Card>
      <Card className="opacity-70"><CardHeader><CardTitle>Webhooks</CardTitle><CardDescription>Send workflow events to external endpoints.</CardDescription></CardHeader><CardContent><p className="text-sm font-medium text-muted-foreground">Coming soon</p></CardContent></Card>
      <Card className="opacity-70"><CardHeader><CardTitle>Push</CardTitle><CardDescription>Send push notifications from workflows.</CardDescription></CardHeader><CardContent><p className="text-sm font-medium text-muted-foreground">Coming soon</p></CardContent></Card>
    </div>
    {onboarding && canManage && <div className="flex items-center justify-between gap-4"><p className="text-sm text-muted-foreground">You can explore and simulate workflows without connecting Resend. Email sending stays disabled until a connection test is accepted.</p><Button type="button" variant="outline" disabled={saving} onClick={() => { void skip(); }}>{saving ? 'Continuing…' : 'Skip for now'}</Button></div>}
  </main>;
}

export function ResendIntegrationPage({ onboarding = false }: { onboarding?: boolean }) {
  const { user, workspaceId, workspaces } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oauthQuery = searchParams.get('oauth_query');
  const completionTarget = oauthQuery ? `/auth/login?oauth_query=${encodeURIComponent(oauthQuery)}` : '/';
  const [status, setStatus] = useState<ResendConnectionStatus | null>(null);
  const [from, setFrom] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ action: 'save' | 'test' | 'skip'; kind: 'error' | 'success'; message: string } | null>(null);
  const [testAccepted, setTestAccepted] = useState(false);
  const role = workspaces.find((workspace) => workspace.id === workspaceId)?.role;
  const canManage = role === 'owner' || role === 'admin';

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void api.resendConnection(workspaceId).then((next) => {
      if (!active) return;
      setStatus(next);
      setFrom(next.from ?? '');
    }).catch((reason: unknown) => {
      if (active) setLoadError(reason instanceof Error ? reason.message : 'Could not load Resend settings');
    });
    return () => { active = false; };
  }, [workspaceId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !canManage) return;
    setSaving(true);
    setFeedback(null);
    setFieldErrors({});
    try {
      await api.saveResendConnection({ workspaceId, from: from.trim(), apiKey: apiKey.trim(), webhookSecret: webhookSecret.trim() });
      setApiKey('');
      setWebhookSecret('');
      setTestAccepted(false);
      try {
        setStatus(await api.resendConnection(workspaceId));
        setFeedback({ action: 'save', kind: 'success', message: 'Resend settings saved. Send a test email to enable workflow sending. The key and signing secret are now hidden.' });
      } catch {
        setFeedback({ action: 'save', kind: 'success', message: 'Resend settings were saved, but the connection status could not be refreshed. Reload this page before sending a test email.' });
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.fieldErrors) {
        setFieldErrors(Object.fromEntries(Object.entries(reason.fieldErrors).flatMap(([field, messages]) => (
          messages[0] ? [[field, messages[0]]] : []
        ))));
      }
      setFeedback({ action: 'save', kind: 'error', message: reason instanceof Error ? reason.message : 'Could not save Resend settings' });
    } finally {
      setSaving(false);
    }
  }

  async function skip() {
    if (!workspaceId) return;
    setSaving(true);
    setFeedback(null);
    try {
      await api.skipResendOnboarding(workspaceId);
      navigate(completionTarget, { replace: true });
    } catch (reason) {
      setFeedback({ action: 'skip', kind: 'error', message: reason instanceof Error ? reason.message : 'Could not continue' });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!workspaceId) return;
    setSaving(true);
    setFeedback(null);
    try {
      await api.testResendConnection(workspaceId);
      setTestAccepted(true);
      try {
        setStatus(await api.resendConnection(workspaceId));
        setFeedback({ action: 'test', kind: 'success', message: `Resend accepted a test email to ${user?.email ?? 'your address'}. Workflow sending is enabled; check the Resend dashboard and your inbox for delivery.` });
      } catch {
        setFeedback({ action: 'test', kind: 'success', message: 'Resend accepted the test email, but the connection status could not be refreshed. Check the Resend dashboard and your inbox for delivery.' });
      }
    } catch (reason) {
      setFeedback({ action: 'test', kind: 'error', message: reason instanceof Error ? reason.message : 'Test email was not accepted' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">{onboarding ? 'Integrations · Email' : 'Organization settings · Integrations'}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Connect Resend</h1>
        <p className="mt-2 text-muted-foreground">Each organization uses its own Resend sending credentials and signed webhook. Only organization owners and admins can change this connection.</p>
      </div>

      {loadError && <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>}
      {status?.configured && <Alert><AlertDescription>Configured with sender {status.from}. {status.lastTestAcceptedAt ? 'A test send was accepted.' : 'Workflow sending is disabled until a test send is accepted.'} Re-enter both secrets below to replace this connection.</AlertDescription></Alert>}
      {status?.lastTestAcceptedAt && <Alert><AlertDescription>Resend accepted a connection test on {new Date(status.lastTestAcceptedAt).toLocaleString()}. Check your inbox or Resend delivery logs to confirm delivery.</AlertDescription></Alert>}
      {status?.configured && canManage && <div className="flex flex-col gap-3">
        <Button type="button" variant="outline" disabled={saving} onClick={() => { void test(); }}>Send a test email to {user?.email}</Button>
        {feedback?.action === 'test' && <Alert variant={feedback.kind === 'error' ? 'destructive' : 'default'} role={feedback.kind === 'error' ? 'alert' : 'status'}><AlertDescription>{feedback.message}</AlertDescription></Alert>}
        {onboarding && testAccepted && <Button type="button" onClick={() => navigate(completionTarget, { replace: true })}>Continue to dashboard</Button>}
      </div>}

      <Card>
        <CardHeader>
          <CardTitle>Set up your Resend account</CardTitle>
          <CardDescription>Complete these steps in the Resend dashboard, then save the details here.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex list-decimal flex-col gap-4 pl-5 text-sm">
            <li><a className="underline underline-offset-4" href="https://resend.com/domains" target="_blank" rel="noreferrer">Verify a sending domain in Resend</a>. Use a dedicated Resend account for this organization; a verified domain is required for real recipients.</li>
            <li><a className="underline underline-offset-4" href="https://resend.com/api-keys" target="_blank" rel="noreferrer">Create a sending-only API key</a>, restricted to that domain when possible. Copy it once.</li>
            <li><a className="underline underline-offset-4" href="https://resend.com/webhooks" target="_blank" rel="noreferrer">Create a webhook</a> for sent, delivered, bounced, complained, and suppressed email events. Set its endpoint URL to:</li>
          </ol>
          <code className="mt-3 block break-all rounded-md bg-muted p-3 text-xs">{status?.webhookUrl ?? 'Loading webhook URL…'}</code>
          <p className="mt-3 text-sm text-muted-foreground">Copy that webhook’s signing secret. The API key and signing secret are different values. Keep both private; Rachet encrypts them at rest and never displays them again.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{status?.configured ? 'Replace Resend connection' : 'Save Resend connection'}</CardTitle>
          <CardDescription>Use a sender on the exact domain you verified in this Resend account.</CardDescription>
        </CardHeader>
        <CardContent>
          {canManage ? (
            <form onSubmit={(event) => { void save(event); }}>
              <FieldGroup>
                <Field data-invalid={Boolean(fieldErrors.from)}>
                  <FieldLabel htmlFor="resend-from">From address</FieldLabel>
                  <Input id="resend-from" type="text" autoComplete="off" required value={from} aria-invalid={Boolean(fieldErrors.from)} onChange={(event) => { setFrom(event.target.value); setFieldErrors((current) => ({ ...current, from: '' })); }} placeholder="Your team <hello@example.com>" />
                  <FieldDescription>Recipients will see this sender. The domain must be verified in the same Resend account.</FieldDescription>
                  <FieldError>{fieldErrors.from}</FieldError>
                </Field>
                <Field data-invalid={Boolean(fieldErrors.apiKey)}>
                  <FieldLabel htmlFor="resend-key">Sending API key</FieldLabel>
                  <Input id="resend-key" type="password" autoComplete="off" required value={apiKey} aria-invalid={Boolean(fieldErrors.apiKey)} onChange={(event) => { setApiKey(event.target.value); setFieldErrors((current) => ({ ...current, apiKey: '' })); }} placeholder="re_…" />
                  <FieldDescription>Use the sending API key from Resend, which starts with re_. This is not your Resend password.</FieldDescription>
                  <FieldError>{fieldErrors.apiKey}</FieldError>
                </Field>
                <Field data-invalid={Boolean(fieldErrors.webhookSecret)}>
                  <FieldLabel htmlFor="resend-secret">Webhook signing secret</FieldLabel>
                  <Input id="resend-secret" type="password" autoComplete="off" required value={webhookSecret} aria-invalid={Boolean(fieldErrors.webhookSecret)} onChange={(event) => { setWebhookSecret(event.target.value); setFieldErrors((current) => ({ ...current, webhookSecret: '' })); }} placeholder="whsec_…" />
                  <FieldError>{fieldErrors.webhookSecret}</FieldError>
                </Field>
                <Button type="submit" disabled={saving || !status}>{saving ? 'Saving…' : 'Save connection'}</Button>
                {feedback?.action === 'save' && <Alert variant={feedback.kind === 'error' ? 'destructive' : 'default'} role={feedback.kind === 'error' ? 'alert' : 'status'}><AlertDescription>{feedback.message}</AlertDescription></Alert>}
              </FieldGroup>
            </form>
          ) : <Alert><AlertDescription>Ask an organization owner or admin to connect Resend.</AlertDescription></Alert>}
        </CardContent>
      </Card>

      {onboarding && canManage && <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">You can build and simulate workflows without sending email.</p>
          <Button type="button" variant="outline" disabled={saving} onClick={() => { void skip(); }}>Skip for now</Button>
        </div>
        {feedback?.action === 'skip' && <Alert variant="destructive"><AlertDescription>{feedback.message}</AlertDescription></Alert>}
      </div>}
      <Button asChild variant="outline"><Link to={`${onboarding ? '/onboarding/integrations' : '/settings/integrations'}${oauthQuery ? `?oauth_query=${encodeURIComponent(oauthQuery)}` : ''}`}>Back to integrations</Link></Button>
    </main>
  );
}
