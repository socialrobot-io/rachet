import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { authClient } from '@/auth-client';
import { useAuth } from '@/auth';
import { callOperation, getSetupStatus } from '@/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PAID_PLANS = [
  { id: 'solo', label: 'Solo', price: '€12/month' },
  { id: 'growth', label: 'Growth', price: '€29/month' },
  { id: 'scale', label: 'Scale', price: '€59/month' },
] as const;

type Usage = {
  billingEnabled: true;
  yearMonth: string;
  plan: string;
  uniqueContacts: number;
  overageContacts: number;
  includedContacts: number;
  softLimit: number;
  graceContacts: number;
  overageEnabled: boolean;
  overageCapCents: number | null;
  overageSpendCents: number;
  heldCount: number;
  historyDays: number;
};

type HeldRow = {
  id: string;
  contactId: string;
  contactEmail: string;
  reason: string;
  createdAt: string;
};

export function BillingPage() {
  const { workspaces, workspaceId } = useAuth();
  const [searchParams] = useSearchParams();
  const [billingEnabled, setBillingEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [held, setHeld] = useState<HeldRow[]>([]);
  const [overageEnabled, setOverageEnabled] = useState(false);
  const [overageCapEuros, setOverageCapEuros] = useState('');
  const workspace = workspaces.find((row) => row.id === workspaceId);
  const requestedPlan = searchParams.get('plan');
  const attemptedPlan = useRef<string | null>(null);

  async function refreshUsage(id: string) {
    const next = await callOperation<Usage | { billingEnabled: false }>('billing.usage', { workspaceId: id });
    if (!next.billingEnabled) {
      setUsage(null);
      setHeld([]);
      return;
    }
    setUsage(next);
    setOverageEnabled(next.overageEnabled);
    setOverageCapEuros(next.overageCapCents !== null ? String(next.overageCapCents / 100) : '');
    const rows = await callOperation<HeldRow[]>('billing.held.list', { workspaceId: id });
    setHeld(rows);
  }

  useEffect(() => {
    void getSetupStatus()
      .then((status) => setBillingEnabled(status.billingEnabled))
      .catch(() => setBillingEnabled(false));
  }, []);

  useEffect(() => {
    if (!billingEnabled || !workspaceId) return;
    void refreshUsage(workspaceId).catch((err) => {
      setError(err instanceof Error ? err.message : 'Could not load usage');
    });
  }, [billingEnabled, workspaceId]);

  useEffect(() => {
    if (!billingEnabled || !workspaceId || !requestedPlan) return;
    if (!PAID_PLANS.some((plan) => plan.id === requestedPlan)) return;
    if (workspace?.plan === requestedPlan) return;
    if (attemptedPlan.current === requestedPlan) return;
    attemptedPlan.current = requestedPlan;
    void upgrade(requestedPlan);
  }, [billingEnabled, workspaceId, requestedPlan, workspace?.plan]);

  async function upgrade(plan: string) {
    if (!workspaceId) return;
    setBusy(plan);
    setError(null);
    const { error: upgradeError } = await authClient.subscription.upgrade({
      plan,
      referenceId: workspaceId,
      successUrl: `${window.location.origin}/settings/billing?upgraded=1`,
      cancelUrl: `${window.location.origin}/settings/billing`,
      disableRedirect: false,
    });
    if (upgradeError) {
      setError(upgradeError.message ?? 'Upgrade failed');
      setBusy(null);
    }
  }

  async function openPortal() {
    if (!workspaceId) return;
    setBusy('portal');
    setError(null);
    const { error: portalError } = await authClient.subscription.billingPortal({
      referenceId: workspaceId,
      returnUrl: `${window.location.origin}/settings/billing`,
      disableRedirect: false,
    });
    if (portalError) {
      setError(portalError.message ?? 'Could not open billing portal');
      setBusy(null);
    }
  }

  async function saveOverage() {
    if (!workspaceId) return;
    setBusy('overage');
    setError(null);
    try {
      const cap = overageCapEuros.trim() === ''
        ? null
        : Math.round(Number(overageCapEuros) * 100);
      if (cap !== null && (!Number.isFinite(cap) || cap < 0)) {
        throw new Error('Enter a valid overage cap in euros, or leave it blank for no cap.');
      }
      const next = await callOperation<Usage>('billing.overage.update', {
        workspaceId,
        overageEnabled,
        overageCapCents: overageEnabled ? cap : null,
      });
      setUsage(next);
      setOverageEnabled(next.overageEnabled);
      setOverageCapEuros(next.overageCapCents !== null ? String(next.overageCapCents / 100) : '');
      const rows = await callOperation<HeldRow[]>('billing.held.list', { workspaceId });
      setHeld(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save overage settings');
    } finally {
      setBusy(null);
    }
  }

  async function discardHeld(heldId: string) {
    if (!workspaceId) return;
    setBusy(heldId);
    setError(null);
    try {
      await callOperation('billing.held.discard', { workspaceId, heldId });
      await refreshUsage(workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not discard held enrollment');
    } finally {
      setBusy(null);
    }
  }

  if (billingEnabled === null) return null;

  if (!billingEnabled) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Billing is off</CardTitle>
            <CardDescription>
              This deployment does not charge for plans. Self-hosted Rachet stays unlimited.
              Cloud operators turn billing on with <code>BILLING_ENABLED=true</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline"><Link to="/pricing">View public pricing</Link></Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const planLabel = workspace?.plan
    ? workspace.plan.charAt(0).toUpperCase() + workspace.plan.slice(1)
    : 'Free';
  const usagePct = usage
    ? Math.min(100, Math.round((usage.uniqueContacts / Math.max(usage.includedContacts, 1)) * 100))
    : 0;
  const paidPlan = workspace?.plan && workspace.plan !== 'free';

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Plan limits apply to this organization. Prices are in EUR and exclude VAT.
        </p>
      </div>

      {error && (
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CreditCard /> Current plan</CardTitle>
          <CardDescription>{workspace?.name ?? 'Organization'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-3xl font-semibold">{planLabel}</p>
          {paidPlan && (
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void openPortal()}>
              {busy === 'portal' ? 'Opening…' : 'Manage billing'}
            </Button>
          )}
        </CardContent>
      </Card>

      {usage && (
        <Card>
          <CardHeader>
            <CardTitle>Usage this month</CardTitle>
            <CardDescription>
              Unique contacts enrolled in {usage.yearMonth}. Finished enrollments are kept for {usage.historyDays} days.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-2 flex justify-between text-sm">
                <span>{usage.uniqueContacts.toLocaleString()} / {usage.includedContacts.toLocaleString()}</span>
                <span className="text-muted-foreground">{usagePct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-foreground transition-all" style={{ width: `${usagePct}%` }} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Soft limit with grace: {usage.softLimit.toLocaleString()}.
              {usage.overageContacts > 0
                ? ` Overage contacts billed this month: ${usage.overageContacts.toLocaleString()} (€${(usage.overageSpendCents / 100).toFixed(2)}).`
                : ''}
            </p>
          </CardContent>
        </Card>
      )}

      {paidPlan && (
        <Card>
          <CardHeader>
            <CardTitle>Overage</CardTitle>
            <CardDescription>
              After the included limit and 10% grace, charge €2.50 per 1,000 contacts. Off by default; enrollments are held instead.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={overageEnabled}
                onChange={(event) => setOverageEnabled(event.target.checked)}
              />
              Allow overage billing
            </label>
            <div className="space-y-2">
              <Label htmlFor="overage-cap">Monthly overage cap (EUR, optional)</Label>
              <Input
                id="overage-cap"
                inputMode="decimal"
                placeholder="No cap"
                disabled={!overageEnabled}
                value={overageCapEuros}
                onChange={(event) => setOverageCapEuros(event.target.value)}
              />
            </div>
            <Button type="button" disabled={busy !== null} onClick={() => void saveOverage()}>
              {busy === 'overage' ? 'Saving…' : 'Save overage settings'}
            </Button>
          </CardContent>
        </Card>
      )}

      {held.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Held enrollments</CardTitle>
            <CardDescription>
              These will start when capacity opens (upgrade, overage, or month reset). Discard ones you no longer need.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {held.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.contactEmail}</p>
                  <p className="text-xs text-muted-foreground">{row.reason.replace('_', ' ')} · {new Date(row.createdAt).toLocaleString()}</p>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void discardHeld(row.id)}>
                  {busy === row.id ? '…' : 'Discard'}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Change plan</CardTitle>
          <CardDescription>Upgrade opens Stripe Checkout. Cancel or change payment details in the billing portal.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {PAID_PLANS.map((plan) => {
            const current = workspace?.plan === plan.id;
            return (
              <div key={plan.id} className="rounded-xl border p-4">
                <p className="font-medium">{plan.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{plan.price}</p>
                <Button
                  type="button"
                  className="mt-4 w-full"
                  disabled={current || busy !== null}
                  onClick={() => void upgrade(plan.id)}
                >
                  {current ? 'Current' : busy === plan.id ? 'Redirecting…' : `Start ${plan.label}`}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </main>
  );
}
