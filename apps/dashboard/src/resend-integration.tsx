import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { api, ApiError } from '@/api';
import { useAuth } from '@/auth';
import type { EmailPolicy, ResendConnectionStatus } from '@/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { DeveloperSetup } from '@/developer-setup';

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
  if (!result || result.workspaceId !== workspaceId) return <div className="p-8" aria-busy="true"><div className="h-24 rounded-xl border bg-card/70" /></div>;
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
    void api.resendConnection(workspaceId).then((next) => {
      if (!active) return;
      setStatus(next);
    })
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
    {workspaceId && <OrganizationId workspaceId={workspaceId} />}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card><CardHeader><CardTitle>Email</CardTitle><CardDescription>Send workflow emails through a provider you connect.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">
        <p className="text-xs font-medium text-muted-foreground">AVAILABLE PROVIDER</p>
        <Button asChild variant="outline" className="justify-between"><Link to={`${onboarding ? '/onboarding/integrations/resend' : '/settings/integrations/resend'}${suffix}`}><span>Resend</span><span className="text-xs text-muted-foreground">{status?.lastTestAcceptedAt ? 'Connected' : status?.configured ? 'Test required' : 'Connect'}</span></Link></Button>
      </CardContent></Card>
      <Card className="opacity-70"><CardHeader><CardTitle>Webhooks</CardTitle><CardDescription>Send workflow events to external endpoints.</CardDescription></CardHeader><CardContent><p className="text-sm font-medium text-muted-foreground">Coming soon</p></CardContent></Card>
      <Card className="opacity-70"><CardHeader><CardTitle>Push</CardTitle><CardDescription>Send push notifications from workflows.</CardDescription></CardHeader><CardContent><p className="text-sm font-medium text-muted-foreground">Coming soon</p></CardContent></Card>
    </div>
    {onboarding && canManage && <div className="flex items-center justify-between gap-4"><p className="text-sm text-muted-foreground">You can explore and simulate workflows without connecting Resend. Email sending stays disabled until a connection test is accepted.</p><Button type="button" variant="outline" disabled={saving} onClick={() => { void skip(); }}>{saving ? 'Continuing…' : 'Skip for now'}</Button></div>}
    <div id="mcp-setup"><DeveloperSetup /></div>
  </main>;
}

function OrganizationId({ workspaceId }: { workspaceId: string }) {
  const [message, setMessage] = useState('');
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
    <div className="min-w-0">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Organization ID</p>
      <p className="mt-1 break-all font-mono text-sm">{workspaceId}</p>
      <p className="mt-1 text-xs text-muted-foreground">Use this id as <span className="font-mono">RACHET_WORKSPACE_ID</span>.</p>
    </div>
    <Button type="button" variant="outline" size="sm" onClick={() => {
      void navigator.clipboard.writeText(workspaceId).then(() => setMessage('Copied')).catch(() => setMessage('Select and copy the text manually.'));
    }}>{message === 'Copied' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{message === 'Copied' ? 'Copied' : 'Copy'}</Button>
    {message === 'Copied' && <p role="status" className="sr-only">Copied</p>}
    {message && message !== 'Copied' && <p role="status" className="w-full text-xs text-muted-foreground">{message}</p>}
  </div>;
}

export function ResendIntegrationPage({ onboarding = false }: { onboarding?: boolean }) {
  const { user, workspaceId, workspaces } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oauthQuery = searchParams.get('oauth_query');
  const completionTarget = oauthQuery ? `/auth/login?oauth_query=${encodeURIComponent(oauthQuery)}` : '/';
  const [status, setStatus] = useState<ResendConnectionStatus | null>(null);
  const [from, setFrom] = useState('');
  const [policy, setPolicy] = useState<EmailPolicy | null>(null);
  const [configureMarketing, setConfigureMarketing] = useState(false);
  const [senderName, setSenderName] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [marketingFromAddress, setMarketingFromAddress] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ action: 'save' | 'test' | 'skip'; kind: 'error' | 'success'; message: string } | null>(null);
  const [testAccepted, setTestAccepted] = useState(false);
  const role = workspaces.find((workspace) => workspace.id === workspaceId)?.role;
  const canManage = role === 'owner' || role === 'admin';
  const needsSecrets = !status?.configured || from.trim() !== (status.from ?? '').trim() || Boolean(apiKey || webhookSecret);
  const previewText = `From: ${marketingFromAddress.trim() || 'news@example.com'}\nTo: recipient@example.com\nSubject: Example marketing email\n\nYour message content\n\nUnsubscribe from ${senderName.trim() || 'Your organization'} marketing emails: https://example.invalid/unsubscribe-preview`;

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void Promise.all([api.resendConnection(workspaceId), api.emailPolicy(workspaceId)]).then(([next, currentPolicy]) => {
      if (!active) return;
      setStatus(next);
      setFrom(next.from ?? '');
      setPolicy(currentPolicy);
      setConfigureMarketing(!!currentPolicy);
      setSenderName(currentPolicy?.senderName ?? '');
      setSupportEmail(currentPolicy?.supportEmail ?? '');
      setMarketingFromAddress(currentPolicy?.marketingFromAddress ?? '');
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
      const result = await api.saveResendConnection({
        workspaceId,
        from: from.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
        ...(configureMarketing ? {
          senderName: senderName.trim(), supportEmail: supportEmail.trim(), marketingFromAddress: marketingFromAddress.trim(),
        } : {}),
      });
      setApiKey('');
      setWebhookSecret('');
      if (result.connectionChanged) setTestAccepted(false);
      try {
        const [nextStatus, nextPolicy] = await Promise.all([api.resendConnection(workspaceId), api.emailPolicy(workspaceId)]);
        setStatus(nextStatus);
        setPolicy(nextPolicy);
        setFeedback({ action: 'save', kind: 'success', message: result.connectionChanged || !nextStatus.lastTestAcceptedAt
          ? 'Email settings saved. Send a test email to enable workflow sending.'
          : 'Email settings saved. Your tested connection remains active.' });
      } catch {
        setFeedback({ action: 'save', kind: 'success', message: 'Email settings were saved, but the status could not be refreshed. Reload this page before sending.' });
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
      {status?.configured && <Alert><AlertDescription>Configured with sender {status.from}. {status.lastTestAcceptedAt ? 'A test send was accepted.' : 'Workflow sending is disabled until a test send is accepted.'} Leave both secrets blank to keep this connection.</AlertDescription></Alert>}
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
          <CardTitle>Email settings</CardTitle>
          <CardDescription>Set the transactional sender. Add marketing details here if you plan to publish marketing workflows.</CardDescription>
        </CardHeader>
        <CardContent>
          {canManage ? (
            <form onSubmit={(event) => { void save(event); }}>
              <FieldGroup>
                <Field data-invalid={Boolean(fieldErrors.from)}>
                  <FieldLabel htmlFor="resend-from">Transactional From address</FieldLabel>
                  <Input id="resend-from" type="text" autoComplete="off" required value={from} aria-invalid={Boolean(fieldErrors.from)} onChange={(event) => { setFrom(event.target.value); setFieldErrors((current) => ({ ...current, from: '' })); }} placeholder="Your team <hello@example.com>" />
                  <FieldDescription>The domain must be verified in this Resend account. Changing this address requires both secrets and a new test send.</FieldDescription>
                  <FieldError>{fieldErrors.from}</FieldError>
                </Field>
                <Field data-invalid={Boolean(fieldErrors.apiKey)}>
                  <FieldLabel htmlFor="resend-key">Sending API key</FieldLabel>
                  <Input id="resend-key" type="password" autoComplete="off" required={needsSecrets} value={apiKey} aria-invalid={Boolean(fieldErrors.apiKey)} onChange={(event) => { setApiKey(event.target.value); setFieldErrors((current) => ({ ...current, apiKey: '' })); }} placeholder={status?.configured ? 'Leave blank to keep current key' : 're_…'} />
                  <FieldDescription>Use a sending API key from Resend. Leave blank with the signing secret to keep your tested connection.</FieldDescription>
                  <FieldError>{fieldErrors.apiKey}</FieldError>
                </Field>
                <Field data-invalid={Boolean(fieldErrors.webhookSecret)}>
                  <FieldLabel htmlFor="resend-secret">Webhook signing secret</FieldLabel>
                  <Input id="resend-secret" type="password" autoComplete="off" required={needsSecrets} value={webhookSecret} aria-invalid={Boolean(fieldErrors.webhookSecret)} onChange={(event) => { setWebhookSecret(event.target.value); setFieldErrors((current) => ({ ...current, webhookSecret: '' })); }} placeholder={status?.configured ? 'Leave blank to keep current secret' : 'whsec_…'} />
                  <FieldError>{fieldErrors.webhookSecret}</FieldError>
                </Field>
                <div className="space-y-4 border-t pt-4">
                  {!policy && <label className="flex items-start gap-3 text-sm">
                    <input type="checkbox" checked={configureMarketing} onChange={(event) => setConfigureMarketing(event.target.checked)} className="mt-1 size-4" />
                    <span><span className="font-medium">Set up marketing email</span><span className="block text-muted-foreground">Required before publishing a marketing workflow. Transactional-only senders can leave this off.</span></span>
                  </label>}
                  {configureMarketing && <div className="space-y-4">
                    {policy && <h2 className="text-sm font-medium">Marketing email</h2>}
                    <Field data-invalid={Boolean(fieldErrors.senderName)}>
                      <FieldLabel htmlFor="marketing-sender-name">Sender name</FieldLabel>
                      <Input id="marketing-sender-name" required maxLength={120} value={senderName} aria-invalid={Boolean(fieldErrors.senderName)} onChange={(event) => { setSenderName(event.target.value); setFieldErrors((current) => ({ ...current, senderName: '' })); }} placeholder="Acme" />
                      <FieldDescription>Shown in the unsubscribe link and on the recipient page.</FieldDescription>
                      <FieldError>{fieldErrors.senderName}</FieldError>
                    </Field>
                    <Field data-invalid={Boolean(fieldErrors.marketingFromAddress)}>
                      <FieldLabel htmlFor="marketing-from">Marketing From address</FieldLabel>
                      <Input id="marketing-from" type="email" required value={marketingFromAddress} aria-invalid={Boolean(fieldErrors.marketingFromAddress)} onChange={(event) => { setMarketingFromAddress(event.target.value); setFieldErrors((current) => ({ ...current, marketingFromAddress: '' })); }} placeholder="news@example.com" />
                      <FieldDescription>Use an address verified by your email provider. Keep it separate from the transactional sender.</FieldDescription>
                      <FieldError>{fieldErrors.marketingFromAddress}</FieldError>
                    </Field>
                    <Field data-invalid={Boolean(fieldErrors.supportEmail)}>
                      <FieldLabel htmlFor="marketing-support-email">Support email</FieldLabel>
                      <Input id="marketing-support-email" type="email" required value={supportEmail} aria-invalid={Boolean(fieldErrors.supportEmail)} onChange={(event) => { setSupportEmail(event.target.value); setFieldErrors((current) => ({ ...current, supportEmail: '' })); }} placeholder="support@example.com" />
                      <FieldDescription>Shown if a recipient needs help with an unsubscribe link.</FieldDescription>
                      <FieldError>{fieldErrors.supportEmail}</FieldError>
                    </Field>
                    <div className="space-y-2 text-sm">
                      <p className="font-medium">Email preview</p>
                      <pre className="whitespace-pre-wrap break-words rounded-md border bg-background p-4 font-mono text-xs leading-relaxed">{previewText}</pre>
                      <p className="text-xs text-muted-foreground">Example only. A real email gets a recipient-specific link.</p>
                    </div>
                  </div>}
                </div>
                <Button type="submit" disabled={saving || !status}>{saving ? 'Saving…' : 'Save email settings'}</Button>
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
