import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Pause, Play, XCircle } from 'lucide-react';
import { api, ApiError } from '@/api';
import { useAuth } from '@/auth';
import {
  EnrollmentList,
  EventsSeen,
  ExecutionTimeline,
  MetaSection,
  NextStep,
  StatusBadge,
} from '@/components';
import { DocumentView } from '@/components/DocumentView';
import { EmailPreviewSheet, type EmailPreview } from '@/components/EmailPreviewSheet';
import { renderWithSamples, templateVersionIdOf } from '@/email-preview';
import {
  buildExecutionTrace,
  compactPreview,
  computeEnrollmentPath,
  contactDisplayName,
  countsByStep,
  formatElapsed,
  formatWhen,
  isActiveEnrollment,
  nodeLabel,
} from '@/flow';
import type { Enrollment, Message, Workflow } from '@/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function useWorkspaceData() {
  const { workspaceId } = useAuth();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) {
      setWorkflows([]);
      setEnrollments([]);
      setMessages([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      api.workflows(workspaceId),
      api.enrollments(workspaceId),
      api.messages(workspaceId),
    ])
      .then(([nextWorkflows, nextEnrollments, nextMessages]) => {
        if (cancelled) return;
        setWorkflows(nextWorkflows);
        setEnrollments(nextEnrollments);
        setMessages(nextMessages);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load workspace');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return { workspaceId, workflows, enrollments, messages, error, loading, setEnrollments };
}

function PageFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">{children}</div>;
}

export function WorkflowsPage() {
  const { workspaceId, workflows, enrollments, error, loading } = useWorkspaceData();
  const { workspaces } = useAuth();
  const workspace = workspaces.find((row) => row.id === workspaceId);

  const rows = useMemo(() => {
    return workflows.map((workflow) => {
      const related = enrollments.filter((enrollment) => enrollment.sequenceId === workflow.id);
      const active = related.filter(isActiveEnrollment);
      const completed = related.filter((enrollment) => enrollment.state === 'completed');
      return { workflow, active: active.length, completed: completed.length };
    });
  }, [workflows, enrollments]);

  if (!workspaceId) {
    return (
      <PageFrame>
        <Alert>
          <AlertDescription>No workspace available for this account.</AlertDescription>
        </Alert>
      </PageFrame>
    );
  }
  if (loading) {
    return (
      <PageFrame>
        <p className="font-mono text-sm text-muted-foreground">Loading workflows…</p>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{workspace?.name ?? 'Workspace'}</BreadcrumbPage>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Workflows</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
            <p className="text-sm text-muted-foreground">
              Published workflows and their live enrollments. Open one to see where people are.
            </p>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {rows.length === 0 ? (
          <Card className="border-dashed shadow-none">
            <CardContent className="py-10 text-sm text-muted-foreground">
              No workflows in this workspace yet.
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden py-0 shadow-none">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Active now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ workflow, active }) => (
                  <TableRow key={workflow.id}>
                    <TableCell className="align-top">
                      <Link
                        to={`/workflows/${workflow.id}`}
                        className="font-medium tracking-tight underline-offset-4 hover:underline"
                      >
                        {workflow.name}
                      </Link>
                      <p className="mt-1 font-mono text-xs leading-relaxed text-muted-foreground">
                        {compactPreview(workflow.definition)}
                      </p>
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusBadge value={workflow.state} />
                    </TableCell>
                    <TableCell className="align-top text-right font-mono tabular-nums">
                      {active.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </PageFrame>
  );
}

export function WorkflowDetailPage() {
  const { workflowId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { workspaceId, workflows, enrollments, error, loading } = useWorkspaceData();
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const workflow = workflows.find((row) => row.id === workflowId);
  const related = useMemo(
    () => enrollments.filter((enrollment) => enrollment.sequenceId === workflowId),
    [enrollments, workflowId],
  );
  const active = useMemo(() => related.filter(isActiveEnrollment), [related]);
  const stepFilter = searchParams.get('step');
  const filtered = stepFilter
    ? active.filter((enrollment) => enrollment.currentStepId === stepFilter)
    : active;
  const counts = useMemo(() => countsByStep(active), [active]);
  const definition = related[0]?.definition ?? workflow?.definition;

  async function openEmailPreview(nodeId: string) {
    const node = definition?.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== 'action' || !workspaceId) return;
    const title = nodeLabel(node);
    const templateVersionId = templateVersionIdOf(node.input);
    if (!templateVersionId) {
      setPreview({ kind: 'error', title, message: 'This step has no published template pinned.' });
      return;
    }
    setPreview({ kind: 'loading', title });
    try {
      const rendered = await renderWithSamples((props) =>
        api.renderTemplate(workspaceId, templateVersionId, props),
      );
      setPreview({
        kind: 'ready',
        title,
        subject: rendered.subject,
        html: rendered.html,
        note: 'Template preview with sample data. Enrollments render with real contact data.',
      });
    } catch (err) {
      setPreview({
        kind: 'error',
        title,
        message: err instanceof ApiError ? err.message : 'Template preview failed',
      });
    }
  }

  if (loading) {
    return (
      <PageFrame>
        <p className="font-mono text-sm text-muted-foreground">Loading workflow…</p>
      </PageFrame>
    );
  }
  if (!workflow || !definition) {
    return (
      <PageFrame>
        <Alert>
          <AlertDescription>Workflow not found.</AlertDescription>
        </Alert>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/">Workflows</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{workflow.name}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{workflow.name}</h1>
              <StatusBadge value={workflow.state} />
            </div>
            <p className="text-sm text-muted-foreground">{workflow.definition.description}</p>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold tracking-tight">Definition</h2>
            <p className="text-sm text-muted-foreground">
              The workflow as a document: branches nest and rejoin inline, waits carry their
              exits. Click an email to preview its template; click a count to filter the list
              below.
            </p>
          </div>
          <DocumentView
            definition={definition}
            counts={counts}
            activeStepId={stepFilter}
            onSelectStep={(nodeId) => setSearchParams({ step: nodeId })}
            onPreviewEmail={(nodeId) => void openEmailPreview(nodeId)}
          />
          {stepFilter && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>
                Filtering at <code className="font-mono text-foreground">{stepFilter}</code>
              </span>
              <Button type="button" variant="outline" size="xs" onClick={() => setSearchParams({})}>
                Clear
              </Button>
            </div>
          )}
        </section>

        <Separator />

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight">Currently enrolled</h2>
            <span className="font-mono text-sm text-muted-foreground tabular-nums">
              {active.length} active
            </span>
          </div>
          <EnrollmentList
            empty={stepFilter ? 'Nobody is at this step right now.' : 'No active enrollments.'}
            items={filtered.map((enrollment) => ({
              id: enrollment.id,
              title: enrollment.contactEmail,
              meta: `${enrollment.state} · ${enrollment.currentStepId ?? '—'}`,
              to: `/enrollments/${enrollment.id}`,
            }))}
          />
        </section>
      </div>
      <EmailPreviewSheet preview={preview} onClose={() => setPreview(null)} />
    </PageFrame>
  );
}

export function EnrollmentDetailPage() {
  const { enrollmentId } = useParams();
  const { workspaceId, enrollments, messages, error, loading, setEnrollments } = useWorkspaceData();
  const enrollment = enrollments.find((row) => row.id === enrollmentId);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EmailPreview | null>(null);

  const enrollmentMessages = useMemo(
    () => messages.filter((message) => message.enrollmentId === enrollmentId),
    [messages, enrollmentId],
  );

  const { items: trace, eventsSeen } = useMemo(() => {
    if (!enrollment) return { items: [], eventsSeen: [] };
    return buildExecutionTrace(
      enrollment.definition,
      enrollment,
      enrollmentMessages,
      enrollment.receivedEvents ?? [],
    );
  }, [enrollment, enrollmentMessages]);

  const path = useMemo(
    () => (enrollment ? computeEnrollmentPath(enrollment.definition, enrollment) : undefined),
    [enrollment],
  );

  const nextItem = trace.find((item) => item.status === 'future');
  const name = enrollment
    ? contactDisplayName(enrollment.contactFields, enrollment.contactEmail)
    : '';

  async function openEmailPreview(nodeId: string) {
    if (!enrollment || !workspaceId) return;
    const node = enrollment.definition.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== 'action') return;
    const title = nodeLabel(node);
    const message = enrollmentMessages.find((candidate) => candidate.stepId === nodeId);
    if (message) {
      setPreview({
        kind: 'ready',
        title,
        subject: message.subject,
        html: message.html,
        recipient: message.recipient,
        state: message.state,
        sentAt: message.acceptedAt ?? message.createdAt,
      });
      return;
    }
    const templateVersionId = templateVersionIdOf(node.input);
    if (!templateVersionId) {
      setPreview({ kind: 'error', title, message: 'This step has no published template pinned.' });
      return;
    }
    setPreview({ kind: 'loading', title });
    try {
      const rendered = await renderWithSamples(
        (props) => api.renderTemplate(workspaceId, templateVersionId, props),
        {
          contact: { email: enrollment.contactEmail, ...enrollment.contactFields },
          variables: enrollment.input,
        },
      );
      setPreview({
        kind: 'ready',
        title,
        subject: rendered.subject,
        html: rendered.html,
        recipient: enrollment.contactEmail,
        note: 'Not sent yet. Preview rendered with this contact\u2019s data.',
      });
    } catch (err) {
      setPreview({
        kind: 'error',
        title,
        message: err instanceof ApiError ? err.message : 'Template preview failed',
      });
    }
  }

  async function control(action: 'pause' | 'resume' | 'cancel') {
    if (!workspaceId || !enrollment) return;
    setBusy(action);
    setActionError(null);
    try {
      if (action === 'pause') await api.pause(workspaceId, enrollment.id);
      if (action === 'resume') await api.resume(workspaceId, enrollment.id);
      if (action === 'cancel') await api.cancel(workspaceId, enrollment.id);
      const next = await api.enrollments(workspaceId);
      setEnrollments(next);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Control failed');
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <PageFrame>
        <p className="font-mono text-sm text-muted-foreground">Loading enrollment…</p>
      </PageFrame>
    );
  }
  if (!enrollment) {
    return (
      <PageFrame>
        <Alert>
          <AlertDescription>Enrollment not found.</AlertDescription>
        </Alert>
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to="/">Workflows</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to={`/workflows/${enrollment.sequenceId}`}>{enrollment.workflowName}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{enrollment.contactEmail}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="flex flex-wrap gap-2">
              {enrollment.state === 'paused' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void control('resume')}
                >
                  <Play data-icon="inline-start" />
                  {busy === 'resume' ? 'Resuming…' : 'Resume'}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null || !isActiveEnrollment(enrollment)}
                  onClick={() => void control('pause')}
                >
                  <Pause data-icon="inline-start" />
                  {busy === 'pause' ? 'Pausing…' : 'Pause'}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null || !isActiveEnrollment(enrollment)}
                onClick={() => void control('cancel')}
              >
                <XCircle data-icon="inline-start" />
                {busy === 'cancel' ? 'Cancelling…' : 'Cancel enrollment'}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">{enrollment.contactEmail}</h1>
              <StatusBadge value={enrollment.state} />
            </div>
            <p className="text-sm text-muted-foreground">
              {enrollment.workflowName} · enrolled {formatWhen(enrollment.createdAt)}
              {name !== enrollment.contactEmail.split('@')[0] ? ` · ${name}` : ''}
            </p>
          </div>
        </div>

        {(error || actionError) && (
          <Alert variant="destructive">
            <AlertDescription>{actionError ?? error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem] xl:gap-14">
          <div className="flex min-w-0 flex-col gap-10">
            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold tracking-tight">Execution</h2>
                <p className="text-sm text-muted-foreground">
                  Where this enrollment sits in the workflow. Routes it did not take are dimmed.
                  Click an email to see what was sent.
                </p>
              </div>
              <DocumentView
                definition={enrollment.definition}
                path={path}
                onPreviewEmail={(nodeId) => void openEmailPreview(nodeId)}
              />
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold tracking-tight">History</h2>
                <p className="text-sm text-muted-foreground">
                  What happened, in order, with timestamps.
                </p>
              </div>
              <ExecutionTimeline items={trace} />
            </section>
          </div>

          <aside className="flex flex-col gap-6 lg:pt-[3.75rem]">
            <MetaSection
              title="Enrollment"
              rows={[
                { label: 'Status', value: <StatusBadge value={enrollment.state} /> },
                {
                  label: 'Current step',
                  value: <span className="font-mono text-xs">{enrollment.currentStepId ?? '—'}</span>,
                },
                { label: 'Started', value: formatWhen(enrollment.createdAt) },
                { label: 'Elapsed', value: formatElapsed(enrollment.createdAt) },
                { label: 'Emails', value: `${enrollmentMessages.length} sent` },
              ]}
            />
            <Separator />
            <EventsSeen events={eventsSeen} />
            {nextItem && (
              <>
                <Separator />
                <NextStep label={nextItem.title} />
              </>
            )}
          </aside>
        </div>
      </div>
      <EmailPreviewSheet preview={preview} onClose={() => setPreview(null)} />
    </PageFrame>
  );
}
