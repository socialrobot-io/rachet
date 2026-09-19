import { Link } from 'react-router-dom';
import { Check, ArrowDown } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TraceItem } from '@/flow';
import { formatWhen } from '@/flow';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export function StatusBadge({ value }: { value: string }) {
  const label = value.replaceAll('_', ' ');
  const running = value === 'running' || value === 'waiting' || value === 'published' || value === 'completed';
  const warn = value === 'paused' || value === 'draft' || value === 'pending_start';
  const bad = value === 'needs_attention' || value === 'failed' || value === 'cancelled';

  return (
    <Badge variant="outline" className="gap-1.5 capitalize">
      <span
        className={cn(
          'size-1.5 rounded-full',
          running && 'bg-success',
          warn && 'bg-warning',
          bad && 'bg-destructive',
          !running && !warn && !bad && 'bg-muted-foreground',
        )}
        aria-hidden
      />
      {label}
    </Badge>
  );
}

export function ExecutionTimeline({ items }: { items: TraceItem[] }) {
  return (
    <ol className="flex flex-col">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <li key={item.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3">
            <div className="relative flex flex-col items-center">
              <TimelineDot status={item.status} />
              {!isLast && <div className="w-px flex-1 bg-border" aria-hidden />}
            </div>
            <div className={cn('min-w-0', isLast ? 'pb-0' : 'pb-6')}>
              {item.status === 'current' ? (
                <Card>
                  <CardContent className="flex flex-col gap-3 pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-[0.7rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                        Current step
                      </span>
                      {item.remainingLabel && (
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          {item.remainingLabel}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <p className="text-base font-semibold tracking-tight">{item.title}</p>
                      {item.detail && <p className="text-sm text-muted-foreground">{item.detail}</p>}
                    </div>
                    {typeof item.progress === 'number' && (
                      <Progress value={item.progress} className="h-1.5" />
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="flex items-start justify-between gap-3 pt-0.5">
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <p
                      className={cn(
                        'font-medium tracking-tight',
                        item.status === 'future' && 'text-muted-foreground',
                      )}
                    >
                      {item.title}
                    </p>
                    {item.detail && (
                      <p className="text-sm text-muted-foreground">{item.detail}</p>
                    )}
                  </div>
                  {item.timestamp && (
                    <time className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                      {formatShortWhen(item.timestamp)}
                    </time>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TimelineDot({ status }: { status: TraceItem['status'] }) {
  if (status === 'past') {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-success text-success-foreground">
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'current') {
    return (
      <span className="mt-2.5 flex size-5 items-center justify-center" aria-hidden>
        <span className="size-2.5 rounded-full bg-foreground ring-4 ring-foreground/10" />
      </span>
    );
  }
  return (
    <span
      className="size-5 rounded-full border-[1.5px] border-muted-foreground/30 bg-background"
      aria-hidden
    />
  );
}

function formatShortWhen(value: string): string {
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(',', ' ·');
}

export function MetaSection({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[0.7rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </h2>
      <dl className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 text-sm">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function EnrollmentList({
  items,
  empty,
}: {
  items: { id: string; title: string; meta: string; to: string }[];
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            to={item.to}
            className="flex items-baseline justify-between gap-3 rounded-lg px-3 py-2.5 hover:bg-muted"
          >
            <span className="truncate font-medium tracking-tight">{item.title}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.meta}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function EventsSeen({ events }: { events: { type: string; receivedAt?: string }[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[0.7rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        Events seen
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((event) => (
            <li key={event.type} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2 font-mono text-xs">
                <span className="size-1 rounded-full bg-success" aria-hidden />
                {event.type}
              </span>
              {event.receivedAt && (
                <span className="pl-3 font-mono text-[0.65rem] text-muted-foreground">
                  {formatWhen(event.receivedAt)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function NextStep({ label }: { label: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[0.7rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        Next
      </h2>
      <div className="flex items-center gap-3 text-sm">
        <span className="flex size-8 items-center justify-center rounded-full border bg-background">
          <ArrowDown className="size-4 text-muted-foreground" />
        </span>
        <span className="font-medium">{label}</span>
      </div>
    </section>
  );
}
