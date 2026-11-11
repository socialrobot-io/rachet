import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/api';
import { useAuth } from '@/auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { EmailPolicy, SesConnectionStatus } from '@/types';

export function SesIntegrationPage({ onboarding = false }: { onboarding?: boolean }) {
  const { user, workspaceId, workspaces } = useAuth();
  if (!workspaceId) return <Alert><AlertDescription>No organization is assigned to this account.</AlertDescription></Alert>;
  const role = workspaces.find((workspace) => workspace.id === workspaceId)?.role;
  return <SesConnectionForm key={workspaceId} workspaceId={workspaceId} email={user?.email}
    canManage={role === 'owner' || role === 'admin'} onboarding={onboarding} />;
}

function SesConnectionForm({ workspaceId, email, canManage, onboarding }: {
  workspaceId: string;
  email: string | undefined;
  canManage: boolean;
  onboarding: boolean;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SesConnectionStatus | null>(null);
  const [policy, setPolicy] = useState<EmailPolicy | null>(null);
  const [settings, setSettings] = useState({ from: '', region: '', configurationSet: '', topicArn: '', accessKeyId: '', secretAccessKey: '' });
  const [busy, setBusy] = useState(false);
  const [simulator, setSimulator] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const connection = status?.connection;
  const oauthQuery = params.get('oauth_query');
  const back = onboarding ? '/onboarding/integrations' : '/settings/integrations';

  useEffect(() => {
    let current = true;
    void Promise.all([api.sesConnection(workspaceId), api.emailPolicy(workspaceId)]).then(([next, nextPolicy]) => {
      if (!current) return;
      setStatus(next);
      setPolicy(nextPolicy);
      if (next.connection) {
        const { from, region, configurationSet, topicArn } = next.connection;
        setSettings({ from, region, configurationSet, topicArn, accessKeyId: '', secretAccessKey: '' });
      }
    }).catch((error: unknown) => {
      if (current) setFeedback({ error: true, message: error instanceof Error ? error.message : 'Could not load Amazon SES settings' });
    });
    return () => { current = false; };
  }, [workspaceId]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setFieldErrors({});
    setFeedback(null);
    try {
      setFeedback({ error: false, message: await action() });
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors) setFieldErrors(error.fieldErrors);
      setFeedback({ error: true, message: error instanceof Error ? error.message : 'Amazon SES request failed' });
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const { accessKeyId, secretAccessKey, ...details } = settings;
      await api.saveSesConnection({
        workspaceId, ...details, ...(accessKeyId.trim() ? { accessKeyId } : {}),
        ...(secretAccessKey.trim() ? { secretAccessKey } : {}),
      });
      setSettings({ ...details, accessKeyId: '', secretAccessKey: '' });
      setStatus(await api.sesConnection(workspaceId));
      return 'Amazon SES settings saved.';
    });
  }

  const requiredKeys = !connection || Boolean(settings.accessKeyId || settings.secretAccessKey);
  const settingsChanged = !!connection && (connection.from !== settings.from.trim() ||
    connection.region !== settings.region.trim() || connection.configurationSet !== settings.configurationSet.trim() ||
    connection.topicArn !== settings.topicArn.trim() || requiredKeys);
  const fields = [
    { name: 'from', label: 'Transactional From address', placeholder: 'Your team <hello@example.com>' },
    { name: 'region', label: 'AWS Region', placeholder: 'eu-west-1' },
    { name: 'configurationSet', label: 'SES configuration set', placeholder: 'rachet' },
    { name: 'topicArn', label: 'SNS topic ARN', placeholder: 'arn:aws:sns:eu-west-1:123456789012:rachet' },
    { name: 'accessKeyId', label: 'IAM access key ID', secret: true },
    { name: 'secretAccessKey', label: 'IAM secret access key', secret: true },
  ] as const;

  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Amazon SES</h1>
      <p className="mt-2 text-muted-foreground">Send workflow and one-off email from your organization’s AWS account.</p>
    </div>

    {feedback && <Alert variant={feedback.error ? 'destructive' : 'default'} role={feedback.error ? 'alert' : 'status'}>
      <AlertDescription>{feedback.message}</AlertDescription>
    </Alert>}

    <Card>
      <CardHeader><CardTitle>Connection settings</CardTitle>
        <CardDescription>Verify the sender in SES. Create a configuration set and an SNS event destination in the same AWS Region.</CardDescription>
      </CardHeader>
      <CardContent>
        {canManage ? <form onSubmit={(event) => { void save(event); }}>
          <FieldGroup>
            {fields.map((field) => {
              const secret = 'secret' in field;
              return <Field key={field.name} data-invalid={Boolean(fieldErrors[field.name])}>
                <FieldLabel htmlFor={`ses-${field.name}`}>{field.label}</FieldLabel>
                <Input id={`ses-${field.name}`} type={secret ? 'password' : 'text'} autoComplete={secret ? 'new-password' : 'off'}
                  required={!secret || requiredKeys} value={settings[field.name]} aria-invalid={Boolean(fieldErrors[field.name])}
                  placeholder={'placeholder' in field ? field.placeholder : connection ? 'Leave blank to keep the saved key' : undefined}
                  onChange={(event) => setSettings((current) => ({ ...current, [field.name]: event.target.value }))} />
                <FieldError>{fieldErrors[field.name]?.[0]}</FieldError>
              </Field>;
            })}
            <FieldDescription>Use an IAM key with permission to send from your verified identity. Rachet encrypts the key when you save it.</FieldDescription>
            <Button type="submit" disabled={busy || !status}>Save connection</Button>
          </FieldGroup>
        </form> : <p className="text-sm text-muted-foreground">{connection ? `Configured with ${connection.from} in ${connection.region}.` : 'Ask an organization owner or admin to connect Amazon SES.'}</p>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Delivery events</CardTitle><CardDescription>After you save the connection, subscribe this endpoint to the SNS topic. Use HTTPS, signature version 2, and leave raw message delivery off.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <code className="block break-all rounded-md bg-muted p-3 text-xs">{status?.webhookUrl ?? 'Loading endpoint…'}</code>
        <p className="text-sm">{connection?.topicConfirmedAt ? 'SNS subscription confirmed' : 'Waiting for SNS subscription confirmation'}</p>
        <Button type="button" variant="outline" disabled={busy || !status} onClick={() => { void run(async () => {
          const next = await api.sesConnection(workspaceId);
          setStatus(next);
          return next.connection?.topicConfirmedAt ? 'SNS subscription confirmed.' : 'SNS subscription confirmation has not arrived.';
        }); }}>Refresh status</Button>
      </CardContent>
    </Card>

    {canManage && connection && <Card>
      <CardHeader><CardTitle>Test and activate</CardTitle>
        <CardDescription>{status?.active && connection.lastTestAcceptedAt ? 'Amazon SES is the active email provider.' : 'An accepted test sets Amazon SES as the active email provider.'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={simulator} onChange={(event) => setSimulator(event.target.checked)} />
          Use the SES mailbox simulator
        </label>
        <Button type="button" disabled={busy || !connection.topicConfirmedAt || settingsChanged} onClick={() => { void run(async () => {
          await api.testSesConnection(workspaceId, simulator);
          setStatus(await api.sesConnection(workspaceId));
          return 'Amazon SES accepted the test email. Sending is enabled.';
        }); }}>{simulator ? 'Test with simulator' : `Send a test email to ${email ?? 'your inbox'}`}</Button>
        {onboarding && status?.active && connection.lastTestAcceptedAt && <Button type="button" variant="outline" className="ml-2" onClick={() => {
          navigate(oauthQuery ? `/auth/login?oauth_query=${encodeURIComponent(oauthQuery)}` : '/', { replace: true });
        }}>Continue to dashboard</Button>}
      </CardContent>
    </Card>}

    {canManage && connection && <MarketingSettings key={policy?.updatedAt ?? ''} policy={policy} busy={busy} onSave={(name, support, from) => {
      void run(async () => {
        if (from.trim().toLowerCase() === (connection.from.match(/<([^<>]+)>$/)?.[1] ?? connection.from).toLowerCase()) {
          throw new Error('Use a different address from transactional email');
        }
        setPolicy(await api.updateEmailPolicy(workspaceId, name, support, from));
        return 'Marketing email settings saved.';
      });
    }} />}

    <Button asChild variant="outline"><Link to={`${back}${oauthQuery ? `?oauth_query=${encodeURIComponent(oauthQuery)}` : ''}`}>Back to integrations</Link></Button>
  </main>;
}

function MarketingSettings({ policy, busy, onSave }: {
  policy: EmailPolicy | null;
  busy: boolean;
  onSave: (name: string, supportEmail: string, from: string) => void;
}) {
  const [name, setName] = useState(policy?.senderName ?? '');
  const [support, setSupport] = useState(policy?.supportEmail ?? '');
  const [from, setFrom] = useState(policy?.marketingFromAddress ?? '');
  return <Card>
    <CardHeader><CardTitle>Marketing email</CardTitle><CardDescription>Use a separate SES-verified From address for marketing email.</CardDescription></CardHeader>
    <CardContent>
      <form onSubmit={(event) => { event.preventDefault(); onSave(name, support, from); }}>
        <FieldGroup>
          <Field><FieldLabel htmlFor="ses-marketing-name">Sender name</FieldLabel>
            <Input id="ses-marketing-name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="ses-marketing-from">Marketing From address</FieldLabel>
            <Input id="ses-marketing-from" type="email" required value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="ses-marketing-support">Support email</FieldLabel>
            <Input id="ses-marketing-support" type="email" required value={support} onChange={(event) => setSupport(event.target.value)} /></Field>
          <Button type="submit" disabled={busy}>Save marketing settings</Button>
        </FieldGroup>
      </form>
    </CardContent>
  </Card>;
}
