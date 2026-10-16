import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Check, CircleCheck, Copy, Layers3, Pause, Play, UsersRound, XCircle } from 'lucide-react';
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
  computeEnrollmentPath,
  contactDisplayName,
  countsByStep,
  formatElapsed,
  formatWhen,
  humanizeId,
  isActiveEnrollment,
  nodeLabel,
} from '@/flow';
import { enrollmentCounts, enrollmentExitReason, enrollmentGroup, type EnrollmentGroup } from '@/enrollment-list';
import { enrollmentWorkflowHref, enrollmentsForView, workflowView, workflowViews } from '@/workflow-versions';
import type { SubscriptionEvent } from '@/types';
import { useWorkspaceData } from '@/workspace-data';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function PageFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">{children}</div>;
}

function CopyId({ id, label }: { id: string; label: string }) {
  const [message, setMessage] = useState('');
  return <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
    <span>{label}</span>
    <code className="break-all font-mono text-foreground">{id}</code>
    <Button type="button" variant="outline" size="xs" aria-label={`Copy ${label}`} onClick={() => {
      void navigator.clipboard.writeText(id).then(() => setMessage('Copied')).catch(() => setMessage('Select and copy the ID manually.'));
    }}>{message === 'Copied' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{message === 'Copied' ? 'Copied' : 'Copy'}</Button>
    {message && <span role="status">{message}</span>}
  </div>;
}

function WorkflowIds({ workflowId, versionId }: { workflowId: string; versionId?: string | null }) {
  return <details className="text-xs text-muted-foreground">
    <summary className="w-fit cursor-pointer">IDs for API and support</summary>
    <CopyId id={workflowId} label="Workflow ID" />
    {versionId && <CopyId key={versionId} id={versionId} label="Version ID" />}
  </details>;
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
    return <PageFrame><p className="font-mono text-sm text-muted-foreground">Loading workflows…</p></PageFrame>;
  }

  const drafts = rows.filter(({ workflow }) => workflow.state === 'draft').length;
  const active = rows.reduce((sum, row) => sum + row.active, 0);

  return (
    <PageFrame>
      <div className="flex flex-col gap-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{workspace?.name ?? 'Workspace'}</p>
            <h1 className="mt-2 text-4xl font-bold tracking-[-0.055em]">Workflows</h1>
            <p className="mt-2 text-sm text-muted-foreground">Your journeys, from first draft to live enrollment.</p>
          </div>
          <Button asChild variant="outline"><Link to="/settings/integrations">Integrations <ArrowUpRight data-icon="inline-end" /></Link></Button>
        </div>

        <section aria-label="Workspace overview" className="grid gap-3 sm:grid-cols-3">
          <Card className="rachet-panel"><CardHeader><CardDescription className="flex items-center gap-2"><Layers3 className="size-4" /> Workflows</CardDescription><CardTitle className="text-3xl font-bold tabular-nums">{rows.length}</CardTitle></CardHeader></Card>
          <Card className="rachet-panel"><CardHeader><CardDescription className="flex items-center gap-2"><CircleCheck className="size-4" /> Ready to review</CardDescription><CardTitle className="text-3xl font-bold tabular-nums">{drafts}</CardTitle></CardHeader></Card>
          <Card className="rachet-panel"><CardHeader><CardDescription className="flex items-center gap-2"><UsersRound className="size-4" /> People in progress</CardDescription><CardTitle className="text-3xl font-bold tabular-nums">{active}</CardTitle></CardHeader></Card>
        </section>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">The work in motion</p>
              <h2 className="mt-1 text-2xl font-bold tracking-[-0.045em]">All journeys</h2>
              <p className="mt-1 text-sm text-muted-foreground">Open a card to explore its steps and outcomes.</p>
            </div>
            <span className="rounded-full bg-accent px-3 py-1 font-mono text-xs font-medium">{rows.length} total</span>
          </div>
          {rows.length === 0 ? (
            <Card className="rachet-panel border-dashed"><CardHeader><CardTitle>No workflows yet</CardTitle><CardDescription>Create your first workflow through the CLI or MCP, then it will appear here.</CardDescription></CardHeader></Card>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {rows.map(({ workflow, active, completed }, index) => (
                <Card key={workflow.id} className="rachet-workflow-card rachet-panel group relative h-full min-h-[21rem] transition-transform duration-200 hover:-translate-y-1">
                  <CardHeader className="gap-4">
                    <div className="rachet-card-art relative flex h-28 items-start justify-between overflow-hidden rounded-xl p-4">
                      <span className="relative z-10 rounded-full bg-card/80 px-3 py-1 font-mono text-[0.65rem] font-semibold uppercase tracking-wide">{workflow.definition.topic?.replaceAll('_', ' ') || 'Workflow'}</span>
                      <span className="absolute -bottom-10 right-2 text-[8rem] font-bold leading-none tracking-[-0.13em] text-foreground/10" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><CardTitle className="text-xl font-semibold tracking-tight"><Link to={`/workflows/${workflow.id}`} className="after:absolute after:inset-0 focus-visible:outline-ring">{workflow.name}</Link></CardTitle><CardDescription className="mt-2 line-clamp-3">{workflow.definition.description || 'A thoughtful journey for your audience.'}</CardDescription></div>
                      <ArrowUpRight className="size-5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
                    </div>
                    <Badge variant="outline">{workflow.publishedVersions.length} published {workflow.publishedVersions.length === 1 ? 'version' : 'versions'}</Badge>
                  </CardHeader>
                  <CardFooter className="mt-auto justify-between gap-2"><StatusBadge value={workflow.state} /><span className="font-mono text-xs text-muted-foreground">{active} active · {completed} done</span></CardFooter>
                </Card>
              ))}
            </div>
          )}
        </section>

      </div>
    </PageFrame>
  );
}

export function EnrollmentsPage() {
  const { workspaceId, workflows, enrollments, error, loading } = useWorkspaceData(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const workflowId = searchParams.get('workflow') ?? 'all';
  const version = workflowId === 'all' ? 'all' : searchParams.get('version') ?? 'all';
  const selectedWorkflow = workflows.find((row) => row.id === workflowId);
  const requestedGroup = searchParams.get('status') ?? 'all';
  const group: EnrollmentGroup = ['all', 'in_progress', 'needs_attention', 'exited'].includes(requestedGroup)
    ? requestedGroup as EnrollmentGroup : 'all';
  const query = searchParams.get('q') ?? '';

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    if (key === 'workflow') next.delete('version');
    setSearchParams(next, { replace: true });
  }

  const scoped = enrollments.filter((row) => (workflowId === 'all' || row.sequenceId === workflowId)
    && (version === 'all' || String(row.workflowVersion) === version));
  const counts = enrollmentCounts(scoped);
  const search = query.trim().toLocaleLowerCase();
  const visible = scoped.filter((row) => {
    if (group !== 'all' && enrollmentGroup(row) !== group) return false;
    if (!search) return true;
    return row.contactEmail.toLocaleLowerCase().includes(search)
      || contactDisplayName(row.contactFields, row.contactEmail).toLocaleLowerCase().includes(search);
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const people = new Set(scoped.map((row) => row.contactId)).size;
  const samples = scoped.some((row) => row.input.demo === true);

  if (!workspaceId) return <PageFrame><Alert><AlertDescription>No workspace available for this account.</AlertDescription></Alert></PageFrame>;
  if (loading) return <PageFrame><p className="font-mono text-sm text-muted-foreground">Loading enrollments…</p></PageFrame>;
  if (error) return <PageFrame><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></PageFrame>;

  return (
    <PageFrame>
      <div className="flex flex-col gap-7">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">People in journeys</p>
          <h1 className="mt-2 text-4xl font-bold tracking-[-0.055em]">Enrollments</h1>
          <p className="mt-2 text-sm text-muted-foreground">See who is in progress and how each journey ended. A person can have more than one enrollment.</p>
        </div>

        <section aria-label="Enrollment overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Enrollments', value: counts.total },
            { label: 'In progress', value: counts.inProgress },
            { label: 'Needs attention', value: counts.needsAttention },
            { label: 'Exited', value: counts.exited },
          ].map((metric) => (
            <Card key={metric.label} className="rachet-panel"><CardHeader><CardDescription>{metric.label}</CardDescription><CardTitle className="text-3xl font-bold tabular-nums">{metric.value}</CardTitle></CardHeader></Card>
          ))}
        </section>

        <section className="flex flex-col gap-4" aria-label="Enrollment list">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">People</h2>
              <p className="text-sm text-muted-foreground">{people} {people === 1 ? 'contact' : 'contacts'} across {counts.total} {counts.total === 1 ? 'enrollment' : 'enrollments'}.</p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">Showing {visible.length}</span>
          </div>
          {samples && <p className="text-xs text-muted-foreground">Counts include sample enrollments. Samples do not run or send email.</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input aria-label="Search contacts" placeholder="Search name or email" value={query} onChange={(event) => setFilter('q', event.target.value)} />
            <select aria-label="Filter by workflow" className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" value={workflowId} onChange={(event) => setFilter('workflow', event.target.value)}>
              <option value="all">All workflows</option>
              {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
            </select>
            <select aria-label="Filter by version" className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" value={version} disabled={!selectedWorkflow} onChange={(event) => setFilter('version', event.target.value)}>
              <option value="all">All versions</option>
              {selectedWorkflow && workflowViews(selectedWorkflow).filter((view) => view.publishedVersionId !== null).map((view) => <option key={view.key} value={view.key}>{view.label}</option>)}
            </select>
            <select aria-label="Filter by status" className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" value={group} onChange={(event) => setFilter('status', event.target.value)}>
              <option value="all">All statuses</option>
              <option value="in_progress">In progress</option>
              <option value="needs_attention">Needs attention</option>
              <option value="exited">Exited</option>
            </select>
          </div>
          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{counts.total === 0 ? 'No enrollments yet.' : 'No enrollments match these filters.'}</div>
          ) : (
            <div className="rounded-xl border">
              <Table className="min-w-[850px]">
                <TableHeader><TableRow>
                  <TableHead>Contact</TableHead><TableHead>Workflow</TableHead><TableHead>Status</TableHead><TableHead>Step or exit reason</TableHead><TableHead>Enrolled</TableHead><TableHead>Last change</TableHead>
                </TableRow></TableHeader>
                <TableBody>{visible.map((row) => {
                  const name = contactDisplayName(row.contactFields, row.contactEmail);
                  const result = enrollmentExitReason(row);
                  return <TableRow key={row.id}>
                    <TableCell><Link className="font-medium text-foreground underline-offset-2 hover:underline" to={`/enrollments/${row.id}`}>{name}</Link><div className="text-xs text-muted-foreground">{row.contactEmail}{row.input.demo === true && ' · Sample'}</div></TableCell>
                    <TableCell><Link className="hover:underline" to={enrollmentWorkflowHref(row)}>{row.workflowName}</Link><div className="mt-1"><Badge variant="outline">v{row.workflowVersion}</Badge></div></TableCell>
                    <TableCell><StatusBadge value={row.state} /></TableCell>
                    <TableCell className="max-w-[18rem] truncate" title={result ?? row.currentStepId ?? undefined}>{result ?? (row.currentStepId ? humanizeId(row.currentStepId) : 'Starting')}</TableCell>
                    <TableCell className="text-muted-foreground">{formatWhen(row.createdAt)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatWhen(row.updatedAt)}</TableCell>
                  </TableRow>;
                })}</TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </PageFrame>
  );
}

export function WorkflowDetailPage() {
  const { workflowId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { workspaceId, workflows, enrollments, error, loading } = useWorkspaceData();
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const previewRequest = useRef(0);
  const workflow = workflows.find((row) => row.id === workflowId);
  const requestedVersion = searchParams.get('version');
  useEffect(() => {
    previewRequest.current += 1;
    setPreview(null);
  }, [workflowId, requestedVersion]);
  const view = useMemo(() => workflow ? workflowView(workflow, requestedVersion) : null, [workflow, requestedVersion]);
  const related = useMemo(
    () => workflow && view ? enrollmentsForView(workflow, view, enrollments) : [],
    [enrollments, workflow, view],
  );
  const active = useMemo(() => related.filter(isActiveEnrollment), [related]);
  const stepFilter = searchParams.get('step');
  const filtered = stepFilter
    ? active.filter((enrollment) => enrollment.currentStepId === stepFilter)
    : active;
  const counts = useMemo(() => countsByStep(active), [active]);
  const definition = view?.definition;

  function selectStep(nodeId: string | null) {
    const next = new URLSearchParams(searchParams);
    if (nodeId) next.set('step', nodeId);
    else next.delete('step');
    setSearchParams(next);
  }

  async function openEmailPreview(nodeId: string) {
    const node = definition?.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== 'action' || !workspaceId) return;
    const title = nodeLabel(node);
    const templateVersionId = templateVersionIdOf(node.input);
    if (!templateVersionId) {
      setPreview({ kind: 'error', title, message: 'This step has no published template pinned.' });
      return;
    }
    const request = ++previewRequest.current;
    setPreview({ kind: 'loading', title });
    try {
      const rendered = await renderWithSamples((props) =>
        api.renderTemplate(workspaceId, templateVersionId, props, definition?.purpose === 'marketing'),
      );
      if (request !== previewRequest.current) return;
      setPreview({
        kind: 'ready',
        title,
        subject: rendered.subject,
        html: rendered.html,
        note: definition?.purpose === 'marketing'
          ? 'Sample data. The unsubscribe footer appears after the workspace email policy is set. Preview links cannot change a preference.'
          : 'Template preview with sample data. Enrollments render with real contact data.',
        ...(definition?.purpose === 'marketing' ? { settingsHref: '/settings/integrations/resend' } : {}),
      });
    } catch (err) {
      if (request !== previewRequest.current) return;
      setPreview({
        kind: 'error',
        title,
        message: err instanceof ApiError ? err.message : 'Template preview failed',
      });
    }
  }

  if (loading) {
    return <PageFrame><p className="font-mono text-sm text-muted-foreground">Loading workflow…</p></PageFrame>;
  }
  if (error) return <PageFrame><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></PageFrame>;
  if (!workflow) {
    return (
      <PageFrame>
        <Alert>
          <AlertDescription>Workflow not found.</AlertDescription>
        </Alert>
      </PageFrame>
    );
  }

  if (!view || !definition) return <PageFrame><Alert><AlertDescription>Workflow version not found. <Link className="underline" to={`/workflows/${workflow.id}`}>Open the latest version</Link>.</AlertDescription></Alert></PageFrame>;

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
              <Badge variant={view.publishedVersionId ? 'secondary' : 'outline'}>{view.publishedVersionId ? `v${view.key} · Published` : 'Draft · Unpublished'}</Badge>
              {definition.purpose && <Badge variant="outline">{humanizeId(definition.purpose)}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{definition.description}</p>
            <div className="flex flex-wrap items-end gap-4 py-2">
              <Field className="w-full sm:w-64">
                <FieldLabel htmlFor="workflow-version">Version</FieldLabel>
                <Select value={view.key} onValueChange={(value) => {
                  const next = new URLSearchParams(searchParams);
                  next.set('version', value);
                  next.delete('step');
                  setSearchParams(next);
                  setPreview(null);
                }}>
                  <SelectTrigger id="workflow-version" className="w-full"><SelectValue>{view.label}</SelectValue></SelectTrigger>
                  <SelectContent><SelectGroup>
                    {workflowViews(workflow).map((option) => <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>)}
                  </SelectGroup></SelectContent>
                </Select>
              </Field>
              <p className="pb-1 text-sm text-muted-foreground">{workflow.publishedVersions.length} published {workflow.publishedVersions.length === 1 ? 'version' : 'versions'}</p>
            </div>
            <p className="text-xs text-muted-foreground">Viewing a version does not move enrollments. Each person stays on the version they entered.</p>
            <WorkflowIds workflowId={workflow.id} versionId={view.publishedVersionId} />
          </div>
        </div>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold tracking-tight">Definition</h2>
            <p className="text-sm text-muted-foreground">
              The workflow as a document: branches nest and rejoin inline, waits carry their
              exits. Click an email to preview its template; click a count to filter the list
              below.
            </p>
          </div>
          <div className="max-w-3xl py-1">
            <DocumentView
              definition={definition}
              counts={counts}
              activeStepId={stepFilter}
              onSelectStep={(nodeId) => selectStep(nodeId)}
              onPreviewEmail={(nodeId) => void openEmailPreview(nodeId)}
            />
          </div>
          {stepFilter && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>
                Filtering at <code className="font-mono text-foreground">{stepFilter}</code>
              </span>
              <Button type="button" variant="outline" size="xs" onClick={() => selectStep(null)}>
                Clear
              </Button>
            </div>
          )}
        </section>

        <Separator />

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight">Currently enrolled</h2>
            <div className="flex items-center gap-3"><span className="font-mono text-sm text-muted-foreground tabular-nums">{active.length} active</span>{view.publishedVersionId && <Link className="text-sm font-medium underline-offset-2 hover:underline" to={`/enrollments?workflow=${workflow.id}&version=${view.key}`}>View all in v{view.key}</Link>}</div>
          </div>
          <EnrollmentList
            empty={view.key === 'draft' ? 'Drafts have no enrollments. Select a published version to see people.' : stepFilter ? 'Nobody is at this step right now.' : `No active enrollments in v${view.key}.`}
            items={filtered.map((enrollment) => ({
              id: enrollment.id,
              title: enrollment.contactEmail,
              meta: `v${enrollment.workflowVersion} · ${enrollment.state} · ${enrollment.currentStepId ?? '—'}`,
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
  const isDemoEnrollment = enrollment?.input.demo === true;
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [subscriptionEvents, setSubscriptionEvents] = useState<SubscriptionEvent[] | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    setSubscriptionEvents(null);
    setSubscriptionError(null);
    void api.subscriptionEvents(workspaceId).then((events) => {
      if (!cancelled) setSubscriptionEvents(events);
    }).catch(() => {
      if (!cancelled) setSubscriptionError('Could not load marketing preference history.');
    });
    return () => { cancelled = true; };
  }, [workspaceId]);

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
    () => (enrollment ? computeEnrollmentPath(enrollment.definition, enrollment, new Set(enrollmentMessages.map((message) => message.stepId))) : undefined),
    [enrollment, enrollmentMessages],
  );

  const nextItem = trace.find((item) => item.status === 'future');
  const name = enrollment
    ? contactDisplayName(enrollment.contactFields, enrollment.contactEmail)
    : '';
  const addressEvents = subscriptionEvents?.filter((event) => event.emailKey === enrollment?.contactEmail.trim().toLowerCase());

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
        (props) => api.renderTemplate(workspaceId, templateVersionId, props, enrollment.definition.purpose === 'marketing'),
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
        ...(enrollment.definition.purpose === 'marketing' ? { settingsHref: '/settings/integrations/resend' } : {}),
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
    return <PageFrame><p className="font-mono text-sm text-muted-foreground">Loading enrollment…</p></PageFrame>;
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
                    <Link to={enrollmentWorkflowHref(enrollment)}>{enrollment.workflowName} · v{enrollment.workflowVersion}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{enrollment.contactEmail}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            {!isDemoEnrollment && <div className="flex flex-wrap gap-2">
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
            </div>}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">{enrollment.contactEmail}</h1>
              <StatusBadge value={enrollment.state} />
              <Badge variant="outline">v{enrollment.workflowVersion}</Badge>
              {isDemoEnrollment && <Badge variant="secondary">Sample data</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {enrollment.workflowName} · v{enrollment.workflowVersion} · enrolled {formatWhen(enrollment.createdAt)}
              {name !== enrollment.contactEmail.split('@')[0] ? ` · ${name}` : ''}
            </p>
            <WorkflowIds workflowId={enrollment.sequenceId} versionId={enrollment.sequenceVersionId} />
          </div>
        </div>

        {(error || actionError) && (
          <Alert variant="destructive">
            <AlertDescription>{actionError ?? error}</AlertDescription>
          </Alert>
        )}

        {isDemoEnrollment && (
          <Alert>
            <AlertDescription>This is a visual demo enrollment. No Temporal execution or email delivery exists; controls are unavailable.</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_15rem] xl:gap-14">
          <div className="flex min-w-0 flex-col gap-10">
            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold tracking-tight">Execution</h2>
                <p className="text-sm text-muted-foreground">
                  Where this enrollment sits in the workflow. Routes it did not take are dimmed.
                  {isDemoEnrollment ? ' Click an email to preview its template.' : ' Click an email to see what was sent.'}
                </p>
              </div>
              <div className="max-w-3xl py-1">
                <DocumentView
                  definition={enrollment.definition}
                  path={path}
                  onPreviewEmail={(nodeId) => void openEmailPreview(nodeId)}
                />
              </div>
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

            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold tracking-tight">Marketing preferences</h2>
              <p className="text-sm text-muted-foreground">Changes for this email address across this workspace.</p>
              {subscriptionError && <p role="alert" className="text-sm text-destructive">{subscriptionError}</p>}
              {!subscriptionError && subscriptionEvents === null && <p className="text-sm text-muted-foreground">Loading preference history…</p>}
              {!subscriptionError && addressEvents?.length === 0 && <p className="text-sm text-muted-foreground">No preference changes recorded.</p>}
              {addressEvents?.slice().reverse().map((event) => (
                <div key={event.id} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">{event.action === 'unsubscribe' ? 'Unsubscribed' : 'Consented'} · {formatWhen(event.createdAt)}</p>
                  {event.origin ? (
                    <p className="text-muted-foreground">From “{event.origin.subject}” in {event.origin.workflowName} (step {event.origin.stepId}).</p>
                  ) : (
                    <p className="text-muted-foreground">Recorded through {event.source}.</p>
                  )}
                  {event.origin && <p className="break-all font-mono text-xs text-muted-foreground">Send {event.origin.intentId}</p>}
                </div>
              ))}
            </section>
          </div>

          <aside className="flex flex-col gap-6 lg:pt-[3.75rem]">
            <MetaSection
              title="Enrollment"
              rows={[
                { label: 'Status', value: <StatusBadge value={enrollment.state} /> },
                ...(enrollmentExitReason(enrollment) ? [{ label: 'Exit reason', value: enrollmentExitReason(enrollment) }] : []),
                {
                  label: 'Current step',
                  value: <span className="font-mono text-xs">{enrollment.currentStepId ?? '—'}</span>,
                },
                { label: 'Started', value: formatWhen(enrollment.createdAt) },
                { label: 'Elapsed', value: formatElapsed(enrollment.createdAt) },
                { label: 'Accepted sends', value: enrollmentMessages.filter((message) => message.state === 'accepted').length },
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
