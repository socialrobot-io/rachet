import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/api';
import { useAuth } from '@/auth';
import { formatWhen } from '@/flow';
import type { AccountSummary } from '@/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function PageFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">{children}</div>;
}

function displayName(name: string): string {
  const trimmed = name.trim();
  return trimmed || 'No name';
}

export function UsersPage() {
  const { deploymentAdmin, loading: authLoading } = useAuth();
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!deploymentAdmin) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.accounts()
      .then((rows) => {
        if (!cancelled) setAccounts(rows);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof ApiError ? reason.message : 'Could not load users');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, deploymentAdmin]);

  if (authLoading || loading) {
    return <PageFrame><p className="font-mono text-sm text-muted-foreground">Loading users…</p></PageFrame>;
  }
  if (!deploymentAdmin) {
    return (
      <PageFrame>
        <Alert>
          <AlertDescription>This page is for the deployment administrator.</AlertDescription>
        </Alert>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <div className="flex flex-col gap-8">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Deployment</p>
          <h1 className="mt-2 text-4xl font-bold tracking-[-0.055em]">Users</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Signed-up accounts. Workflow and enrolled counts cover every organization that account belongs to. Enrolled counts are distinct contacts with at least one enrollment.
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="overflow-x-auto rounded-xl border">
          <Table className="min-w-[56rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead className="text-right">Workflows</TableHead>
                <TableHead className="text-right">Enrolled</TableHead>
                <TableHead>Signed up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">No signed-up users.</TableCell>
                </TableRow>
              ) : accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">
                    {displayName(account.name)}
                    {account.disabled && <Badge variant="secondary" className="ml-2">Disabled</Badge>}
                  </TableCell>
                  <TableCell>{account.email}</TableCell>
                  <TableCell>{account.organizations.map((organization) => organization.name).join(', ') || 'None'}</TableCell>
                  <TableCell className="text-right tabular-nums">{account.workflowCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{account.enrolledCount}</TableCell>
                  <TableCell>{formatWhen(account.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </PageFrame>
  );
}
