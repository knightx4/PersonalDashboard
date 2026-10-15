'use client';

import { useActionState, useId, useState } from 'react';
import { ActionMenu } from '@/components/ui/action-menu';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Field, FieldError, Input, Select } from '@/components/ui/field';
import { SectionLabel } from '@/components/ui/section-heading';
import { Segmented } from '@/components/ui/segmented';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { canCountAny, metricLine, type MetricList } from '@/lib/goals/metric-form';
import { MAX_TARGET, type Metric, type MetricInput, type MetricPeriod } from '@/lib/goals/metrics';
import {
  addMetricAction,
  changeMetricAction,
  removeMetricAction,
  type MetricActionState,
} from './metric-actions';

/** What the gallery holds open, since a hover and a pending press cannot be photographed. */
export type MetricsShown = {
  /** The form open: a new metric, or the one with this id being changed. */
  open?: 'add' | string;
  /** The row menu showing on this metric, as a hover or focus shows it. */
  revealed?: string;
  /** The form's button mid-save. */
  pending?: boolean;
  /** The form's message, as a refused save leaves it. */
  state?: MetricActionState;
};

/**
 * A goal's metrics in its properties column (plan #2084.3): each one's name
 * and what it counts, with Change and Remove in a row menu, and a line that
 * opens a small form in place for a new one. The form asks for a name, a
 * list, one of that list's dates, week or month, and an optional aim. The
 * Overview's chart reads the same rows, so it follows each change on the
 * revalidated page.
 *
 * A goal with no lists has nothing to count and draws nothing here; one whose
 * lists hold no date says so in place of the add line.
 */
export function MetricsProperty({
  goalId,
  metrics,
  lists,
  shown,
}: {
  goalId: string;
  metrics: Metric[];
  lists: MetricList[];
  shown?: MetricsShown;
}) {
  const [open, setOpen] = useState<string | null>(shown?.open ?? null);
  const headingId = useId();
  const countable = canCountAny(lists);
  if (metrics.length === 0 && lists.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-3 border-t border-border pt-3 lg:mt-2.5 lg:pt-2.5"
    >
      <SectionLabel as="h3" className="mb-1.5" count={metrics.length || undefined}>
        <span id={headingId}>Metrics</span>
      </SectionLabel>
      {metrics.length > 0 && (
        <ul className="space-y-1">
          {metrics.map((metric) =>
            open === metric.id ? (
              <li key={metric.id}>
                <MetricForm
                  goalId={goalId}
                  lists={lists}
                  metric={metric}
                  shown={shown?.open === metric.id ? shown : undefined}
                  onDone={() => setOpen(null)}
                />
              </li>
            ) : (
              <MetricRow
                key={metric.id}
                goalId={goalId}
                metric={metric}
                lists={lists}
                revealed={shown?.revealed === metric.id}
                onChange={() => setOpen(metric.id)}
              />
            ),
          )}
        </ul>
      )}
      {!countable ? (
        <p className="text-small text-ink-muted">No list on this goal has a date to count by.</p>
      ) : open === 'add' ? (
        <MetricForm
          // Set apart from the rows above, so it reads as a new metric.
          className={metrics.length > 0 ? 'mt-1.5 border-t border-border pt-2.5' : undefined}
          goalId={goalId}
          lists={lists}
          shown={shown?.open === 'add' ? shown : undefined}
          onDone={() => setOpen(null)}
        />
      ) : (
        <AddTrigger label="Add a metric" onClick={() => setOpen('add')} />
      )}
    </section>
  );
}

function MetricRow({
  goalId,
  metric,
  lists,
  revealed,
  onChange,
}: {
  goalId: string;
  metric: Metric;
  lists: MetricList[];
  revealed: boolean;
  onChange: () => void;
}) {
  const toast = useToast();
  const remove = async (form: FormData) => {
    const result = await removeMetricAction(form);
    if (result.error) toast({ text: result.error });
  };
  return (
    <li className="group -mx-1.5 flex items-start gap-1 rounded-control px-1.5 py-1 hover:bg-sunken">
      <div className="min-w-0 flex-1">
        <p className="text-ui text-ink [overflow-wrap:anywhere]">{metric.name}</p>
        <p className="tabular text-small text-ink-muted">{metricLine(metric, lists)}</p>
      </div>
      <div
        className={cn(
          'shrink-0 transition-opacity duration-quick',
          !revealed && 'sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100',
        )}
      >
        <ActionMenu
          label={`${metric.name} actions`}
          items={[
            { id: 'change', label: 'Change', onSelect: onChange },
            {
              id: 'remove',
              label: 'Remove',
              destructive: true,
              confirm: 'Remove? Its records stay',
              formAction: remove,
              formFields: { goalId, metricId: metric.id },
            },
          ]}
        />
      </div>
    </li>
  );
}

const PERIODS: { value: MetricPeriod; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

function MetricForm({
  goalId,
  lists,
  metric,
  shown,
  onDone,
  className,
}: {
  goalId: string;
  lists: MetricList[];
  /** The metric being changed; absent for a new one. */
  metric?: Metric;
  shown?: MetricsShown;
  onDone: () => void;
  className?: string;
}) {
  const id = useId();
  const firstCountable = lists.find((l) => l.dateFields.length > 0);
  const [listId, setListId] = useState(metric?.collectionId ?? firstCountable?.id ?? '');
  const [period, setPeriod] = useState<MetricPeriod>(metric?.period ?? 'week');
  const [state, save, saving] = useActionState(
    async (prev: MetricActionState, form: FormData) => {
      const next = await (metric ? changeMetricAction : addMetricAction)(prev, form);
      if (next.done) onDone();
      return next;
    },
    shown?.state ?? {},
  );
  const pending = saving || shown?.pending === true;
  const list = lists.find((l) => l.id === listId);
  const dates = list?.dateFields ?? [];
  const keptDate = metric && metric.collectionId === listId ? metric.dateField : undefined;
  const errorOn = (field: keyof MetricInput) => (state.field === field ? state.error : undefined);

  return (
    <form
      action={save}
      aria-label={metric ? `Change ${metric.name}` : 'Add a metric'}
      className={cn('space-y-2.5 py-1', className)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDone();
      }}
    >
      <input type="hidden" name="goalId" value={goalId} />
      {metric && <input type="hidden" name="metricId" value={metric.id} />}
      <input type="hidden" name="period" value={period} />
      <Field id={`${id}-name`} label="Name" error={errorOn('name')}>
        <Input
          id={`${id}-name`}
          name="name"
          required
          maxLength={200}
          defaultValue={metric?.name ?? ''}
          placeholder="Applications per week"
          // The form opens because the person asked for it.
          autoFocus
        />
      </Field>
      <Field id={`${id}-list`} label="List to count" error={errorOn('collectionId')}>
        <Select
          id={`${id}-list`}
          name="collectionId"
          value={listId}
          onChange={(event) => setListId(event.target.value)}
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id} disabled={l.dateFields.length === 0}>
              {l.dateFields.length === 0 ? `${l.name} (no date)` : l.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id={`${id}-date`} label="Count by" error={errorOn('dateField')}>
        <Select
          // A new list starts on its first date.
          key={listId}
          id={`${id}-date`}
          name="dateField"
          defaultValue={keptDate ?? dates[0]?.key}
        >
          {dates.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <p id={`${id}-per`} className="mb-1 text-small font-medium text-ink-muted">
          Per
        </p>
        <Segmented
          label="Count per week or month"
          value={period}
          options={PERIODS}
          onChange={setPeriod}
          className="flex w-full *:flex-1 *:justify-center"
        />
        <FieldError>{errorOn('period')}</FieldError>
      </div>
      <Field id={`${id}-target`} label={`Aim per ${period}, if any`} error={errorOn('target')}>
        <Input
          id={`${id}-target`}
          name="target"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={String(MAX_TARGET).length}
          defaultValue={metric?.target ?? ''}
          className="tabular"
        />
      </Field>
      {state.error && !state.field && <FieldError>{state.error}</FieldError>}
      <div className="flex items-center gap-2 pt-0.5">
        <Button type="submit" size="sm" pending={pending}>
          {metric ? (pending ? 'Saving…' : 'Save') : pending ? 'Adding…' : 'Add metric'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
