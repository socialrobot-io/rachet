import { useMemo, type ReactNode } from 'react';
import {
  Check,
  CircleDot,
  Clock,
  Eye,
  GitBranch,
  LogOut,
  Mail,
  Play,
  Square,
  UserRound,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDuration, nodeLabel, type EnrollmentPath } from '@/flow';
import { commonPrefix, structureWorkflow, titleize, type Block } from '@/structure';
import type { WorkflowDefinition } from '@/types';

type BlockStatus = 'past' | 'current' | 'future' | 'default';

type Paint = {
  path?: EnrollmentPath | undefined;
  counts?: Map<string, number> | undefined;
  activeStepId?: string | null | undefined;
  onSelectStep?: ((nodeId: string) => void) | undefined;
  onPreviewEmail?: ((nodeId: string) => void) | undefined;
};

function StatusMark({ status }: { status: BlockStatus }) {
  if (status === 'current') {
    return (
      <Badge variant="secondary" className="gap-1 font-mono text-[10px] uppercase tracking-wide">
        <CircleDot className="size-3 animate-pulse" />
        Current
      </Badge>
    );
  }
  if (status === 'past') return <Check className="size-3.5 shrink-0 text-success" />;
  return null;
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="rounded-full bg-foreground px-1.5 py-0.5 font-mono text-[10px] leading-none text-background">
      {count.toLocaleString()}
    </span>
  );
}

/** Count badge that filters the enrollment list; separate from row clicks. */
function FilterBadge({
  count,
  onFilter,
}: {
  count: number;
  onFilter: (() => void) | undefined;
}) {
  if (count <= 0) return null;
  if (!onFilter) return <CountBadge count={count} />;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onFilter();
      }}
      title="Filter enrollments at this step"
      className="cursor-pointer rounded-full bg-foreground px-1.5 py-0.5 font-mono text-[10px] leading-none text-background transition-opacity hover:opacity-75"
    >
      {count.toLocaleString()}
    </button>
  );
}

/** Vertical rail connecting sibling blocks, aligned under the row icons. */
function Rail() {
  return <div className="ml-[1.05rem] h-2.5 w-px bg-border" aria-hidden />;
}

function actionTitle(node: Extract<Block, { kind: 'action' }>['node']): string {
  return nodeLabel(node);
}

function ActionIcon({ action }: { action: string }) {
  const className = 'size-3.5 shrink-0 text-muted-foreground';
  if (action === 'contact.update') return <UserRound className={className} aria-hidden />;
  if (action === 'email.send') return <Mail className={className} aria-hidden />;
  return <Zap className={className} aria-hidden />;
}

function ActionRow({
  id,
  action,
  title,
  hint,
  status,
  count,
  active,
  onSelect,
  onPreview,
}: {
  id: string;
  action: string;
  title: string;
  hint?: string | undefined;
  status: BlockStatus;
  count: number;
  active: boolean;
  onSelect?: ((nodeId: string) => void) | undefined;
  onPreview?: ((nodeId: string) => void) | undefined;
}) {
  const filterable = Boolean(onSelect) && count > 0;
  // Email rows: the row opens the template/sent-email preview, the count badge
  // filters. Other rows keep row-click filtering.
  const rowAction = onPreview ? () => onPreview(id) : filterable ? () => onSelect?.(id) : null;
  return (
    <div
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md border bg-card px-3 py-2 text-sm transition-colors',
        status === 'past' && 'border-success/40 bg-success/5',
        status === 'current' && 'border-primary bg-primary/5',
        status === 'future' && 'opacity-60',
        active && 'ring-2 ring-primary/30',
        rowAction && 'cursor-pointer hover:bg-accent',
      )}
      title={id}
      onClick={rowAction ? () => rowAction() : undefined}
      role={rowAction ? 'button' : undefined}
      tabIndex={rowAction ? 0 : undefined}
      onKeyDown={
        rowAction
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                rowAction();
              }
            }
          : undefined
      }
    >
      <ActionIcon action={action} />
      <span className="min-w-0 flex-1 truncate font-medium tracking-tight">{title}</span>
      {hint && (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {hint}
        </span>
      )}
      {onPreview && <Eye className="size-3.5 shrink-0 text-muted-foreground/60" />}
      <StatusMark status={status} />
      {onPreview ? (
        <FilterBadge count={count} onFilter={filterable ? () => onSelect?.(id) : undefined} />
      ) : (
        <CountBadge count={count} />
      )}
    </div>
  );
}

function DelayRow({ block, status }: { block: Extract<Block, { kind: 'delay' }>; status: BlockStatus }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-3 py-1 text-xs text-muted-foreground',
        status === 'future' && 'opacity-60',
      )}
      title={block.id}
    >
      <Clock className="size-3 shrink-0" />
      <span>Wait {formatDuration(block.node.durationSeconds).slice(1)}</span>
      <StatusMark status={status} />
    </div>
  );
}

function ExitRow({
  block,
  status,
  count,
}: {
  block: Extract<Block, { kind: 'exit' }>;
  status: BlockStatus;
  count: number;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground',
        status === 'past' && 'border-success/50 text-foreground',
        status === 'future' && 'opacity-60',
      )}
      title={block.id}
    >
      <Square className="size-3 shrink-0" />
      <span>Exit · {titleize(block.node.reason)}</span>
      <StatusMark status={status} />
      <CountBadge count={count} />
    </div>
  );
}

/** One-line guard: one arm empty, the other terminates immediately. */
function ExitGuardRow({
  label,
  exit,
  negated,
  status,
}: {
  label: string;
  exit: Extract<Block, { kind: 'exit' }>;
  negated: boolean;
  status: BlockStatus;
}) {
  const plain = label.replace(/\?$/, '');
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] leading-4 text-red-700',
        status === 'future' && 'opacity-60',
      )}
      title={exit.id}
    >
      <LogOut className="size-3 shrink-0" />
      <span className="truncate">
        If {negated ? 'not ' : ''}
        {plain} → Exit: {titleize(exit.node.reason)}
      </span>
      <StatusMark status={status} />
    </div>
  );
}

function LaneLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-1 pb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </div>
  );
}

function RouteLabel({ label, taken, decided }: { label: string; taken: boolean; decided: boolean }) {
  return (
    <LaneLabel>
      <span className="inline-flex items-center gap-1.5">
        {label}
        {decided && (
          <span className={cn(
            'rounded-full px-1.5 py-0.5 text-[9px] tracking-normal',
            taken ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
          )}>
            {taken ? 'Taken' : 'Not taken'}
          </span>
        )}
      </span>
    </LaneLabel>
  );
}

function Sequence({ blocks, paint, dimmed }: { blocks: Block[]; paint: Paint; dimmed?: boolean }) {
  return (
    <div className={cn('flex flex-col', dimmed && 'opacity-40')}>
      {blocks.map((block, index) => (
        <div key={block.id} className="flex flex-col">
          {index > 0 && <Rail />}
          <BlockView block={block} paint={paint} />
        </div>
      ))}
    </div>
  );
}

function BranchView({ block, paint }: { block: Extract<Block, { kind: 'branch' }>; paint: Paint }) {
  const { path } = paint;
  const status = statusOf(block.id, paint);
  const label = nodeLabel(block.node);
  const yes = block.yes;
  const no = block.no;

  // Which arm did this enrollment take? The untaken arm dims.
  const tookYes = path?.edgeKeys.has(`${block.id}->${block.node.onTrue}`) ?? false;
  const tookNo = path?.edgeKeys.has(`${block.id}->${block.node.onFalse}`) ?? false;
  const decided = tookYes || tookNo;

  // Exit guard: one arm empty, the other is just an exit.
  const exitArm = yes.length === 1 && yes[0].kind === 'exit' ? { exit: yes[0], negated: false }
    : no.length === 1 && no[0].kind === 'exit' ? { exit: no[0], negated: true }
    : null;
  const otherEmpty = exitArm
    ? (exitArm.negated ? yes : no).length === 0
    : false;
  if (exitArm && otherEmpty) {
    return <ExitGuardRow label={label} exit={exitArm.exit} negated={exitArm.negated} status={status} />;
  }

  // Variant split: each arm is exactly one action (locale/content variants).
  if (yes.length === 1 && no.length === 1 && yes[0].kind === 'action' && no[0].kind === 'action') {
    const prefix = commonPrefix([yes[0].id, no[0].id]);
    const rows = [
      { arm: yes[0], taken: tookYes, dim: tookNo },
      { arm: no[0], taken: tookNo, dim: tookYes },
    ];
    return (
      <div
        className={cn(
          'rounded-lg border bg-card',
          status === 'current' && 'border-primary ring-2 ring-primary/30',
          status === 'future' && 'opacity-80',
        )}
      >
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{label}</span>
          <StatusMark status={status} />
        </div>
        <div className="flex flex-col gap-1.5 p-2">
          {rows.map(({ arm, dim }) => (
            <div key={arm.id} className={cn(dim && 'opacity-40')}>
              <ActionRow
                id={arm.id}
                action={arm.node.action}
                title={actionTitle(arm.node)}
                hint={prefix ? arm.id.slice(prefix.length).replaceAll('_', ' ').toUpperCase() : undefined}
                status={statusOf(arm.id, paint)}
                count={paint.counts?.get(arm.id) ?? 0}
                active={paint.activeStepId === arm.id}
                onSelect={paint.onSelectStep}
                onPreview={arm.node.action === 'email.send' ? paint.onPreviewEmail : undefined}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Single-arm branch: guard header with one indented region.
  if (yes.length === 0 || no.length === 0) {
    const content = yes.length === 0 ? no : yes;
    const skipWhenTrue = yes.length === 0;
    const plain = label.replace(/\?$/, '');
    const contentDimmed = skipWhenTrue ? tookYes : tookNo;
    return (
      <div className="flex flex-col">
        <div
          className={cn(
            'inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] leading-4',
            skipWhenTrue
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-blue-200 bg-blue-50 text-blue-700',
            status === 'future' && 'opacity-60',
          )}
          title={block.id}
        >
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">
            {skipWhenTrue ? 'Skip if' : 'Only if'} {plain}
          </span>
          <StatusMark status={status} />
        </div>
        <div className="ml-[1.05rem] border-l border-border pl-3 pt-2">
          <Sequence blocks={content} paint={paint} dimmed={contentDimmed} />
        </div>
      </div>
    );
  }

  // Two-arm branch: contained region, lanes rejoin at the bottom edge.
  return (
    <div
      className={cn(
        'rounded-lg border bg-card',
        status === 'current' && 'border-primary ring-2 ring-primary/30',
        status === 'future' && 'opacity-80',
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium tracking-tight">{label}</span>
        <StatusMark status={status} />
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        <div>
          <RouteLabel label="Yes" taken={tookYes} decided={decided} />
          <Sequence blocks={yes} paint={paint} dimmed={tookNo} />
        </div>
        <div>
          <RouteLabel label="No" taken={tookNo} decided={decided} />
          <Sequence blocks={no} paint={paint} dimmed={tookYes} />
        </div>
      </div>
    </div>
  );
}

function WaitView({ block, paint }: { block: Extract<Block, { kind: 'wait' }>; paint: Paint }) {
  const { path } = paint;
  const status = statusOf(block.id, paint);
  const count = paint.counts?.get(block.id) ?? 0;
  const clickable = Boolean(paint.onSelectStep) && count > 0;
  const tookEvent = path?.edgeKeys.has(`${block.id}->${block.node.onEvent}`) ?? false;
  const tookTimeout = path?.edgeKeys.has(`${block.id}->${block.node.onTimeout}`) ?? false;

  const eventExit =
    block.eventArm.length === 1 && block.eventArm[0].kind === 'exit' ? block.eventArm[0] : null;
  const timeoutExit =
    block.timeoutArm.length === 1 && block.timeoutArm[0].kind === 'exit' ? block.timeoutArm[0] : null;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        disabled={!clickable}
        onClick={() => paint.onSelectStep?.(block.id)}
        className={cn(
          'inline-flex w-fit max-w-full items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-xs',
          status === 'current' && 'border-primary ring-2 ring-primary/30',
          status === 'future' && 'opacity-70',
          paint.activeStepId === block.id && 'ring-2 ring-primary/30',
          clickable ? 'cursor-pointer hover:bg-accent' : 'cursor-default',
        )}
        title={block.id}
      >
        <Clock className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">Wait {formatDuration(block.node.timeoutSeconds).slice(1)}</span>
        {eventExit ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
            <LogOut className="size-2.5" />
            On {block.node.eventType} → Exit: {titleize(eventExit.node.reason)}
          </span>
        ) : block.eventArm.length === 0 ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            on {block.node.eventType} → continue
          </span>
        ) : null}
        {timeoutExit && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <LogOut className="size-2.5" />
            On timeout → Exit: {titleize(timeoutExit.node.reason)}
          </span>
        )}
        <StatusMark status={status} />
        <CountBadge count={count} />
      </button>
      {!eventExit && block.eventArm.length > 0 && (
        <div className="ml-[1.05rem] border-l border-border pl-3 pt-2">
          <LaneLabel>on {block.node.eventType}</LaneLabel>
          <Sequence blocks={block.eventArm} paint={paint} dimmed={tookTimeout} />
        </div>
      )}
      {!timeoutExit && block.timeoutArm.length > 0 && (
        <div className="ml-[1.05rem] border-l border-border pl-3 pt-2">
          <LaneLabel>on timeout</LaneLabel>
          <Sequence blocks={block.timeoutArm} paint={paint} dimmed={tookEvent} />
        </div>
      )}
    </div>
  );
}

function statusOf(id: string, paint: Paint): BlockStatus {
  const { path } = paint;
  if (!path) return 'default';
  if (id === path.currentId) return 'current';
  return path.nodeIds.has(id) ? 'past' : 'future';
}

function BlockView({ block, paint }: { block: Block; paint: Paint }) {
  switch (block.kind) {
    case 'action':
      return (
        <ActionRow
          id={block.id}
          action={block.node.action}
          title={actionTitle(block.node)}
          status={statusOf(block.id, paint)}
          count={paint.counts?.get(block.id) ?? 0}
          active={paint.activeStepId === block.id}
          onSelect={paint.onSelectStep}
          onPreview={block.node.action === 'email.send' ? paint.onPreviewEmail : undefined}
        />
      );
    case 'delay':
      return <DelayRow block={block} status={statusOf(block.id, paint)} />;
    case 'branch':
      return <BranchView block={block} paint={paint} />;
    case 'wait':
      return <WaitView block={block} paint={paint} />;
    case 'exit':
      return (
        <ExitRow block={block} status={statusOf(block.id, paint)} count={paint.counts?.get(block.id) ?? 0} />
      );
  }
}

function TriggerPill({ definition }: { definition: WorkflowDefinition }) {
  const trigger = definition.trigger;
  const label =
    trigger.type === 'event'
      ? `On event · ${trigger.eventType}`
      : trigger.type === 'schedule'
        ? `Scheduled · ${trigger.at} (${trigger.timeZone})`
        : 'Manual trigger';
  return (
    <div className="inline-flex w-fit items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-xs font-medium">
      <Play className="size-3 text-muted-foreground" />
      {label}
    </div>
  );
}

function FallbackList({ definition }: { definition: WorkflowDefinition }) {
  return (
    <div className="reflow-document flex w-full flex-col gap-2 rounded-2xl border border-foreground/8 px-4 py-4 sm:px-5 sm:py-5">
      <p className="text-sm text-muted-foreground">
        This workflow cannot be displayed as a document; showing its definition order instead.
      </p>
      <div className="flex flex-col gap-1">
        {definition.nodes.map((node) => (
          <div key={node.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
            <Zap className="size-3 text-muted-foreground" />
            <span className="font-mono">{node.id}</span>
            <span className="text-muted-foreground">{node.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The workflow as a structured document: a top-to-bottom block tree where
 * branches are contained regions that rejoin implicitly. The same tree renders
 * the definition (with counts) and an enrollment (with its path painted and
 * untaken arms dimmed); the layout never changes between the two.
 */
export function DocumentView({
  definition,
  path,
  counts,
  activeStepId,
  onSelectStep,
  onPreviewEmail,
}: {
  definition: WorkflowDefinition;
  path?: EnrollmentPath | undefined;
  counts?: Map<string, number> | undefined;
  activeStepId?: string | null | undefined;
  onSelectStep?: ((nodeId: string) => void) | undefined;
  onPreviewEmail?: ((nodeId: string) => void) | undefined;
}) {
  const tree = useMemo(() => structureWorkflow(definition), [definition]);
  if (!tree) return <FallbackList definition={definition} />;
  const paint: Paint = { path, counts, activeStepId, onSelectStep, onPreviewEmail };
  return (
    <div className="reflow-document flex w-full flex-col rounded-2xl border border-foreground/8 px-4 py-4 sm:px-5 sm:py-5">
      <TriggerPill definition={definition} />
      <Rail />
      <Sequence blocks={tree} paint={paint} />
    </div>
  );
}
