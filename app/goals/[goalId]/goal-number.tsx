'use client';

import { useActionState, useRef, useState } from 'react';
import { ActionMenu } from '@/components/ui/action-menu';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { InlineInput, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import {
  READING_NOTE_MAX,
  UNIT_MAX,
  formatReading,
  movementLine,
  readingChart,
  type Reading,
} from '@/lib/goals/readings';
import {
  addReadingAction,
  deleteReadingAction,
  setMeasureAction,
  type ReadingActionState,
} from './reading-actions';

const initial: ReadingActionState = {};

function formatDay(isoDate: string, withYear = false): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/**
 * A goal's number (plan #930): what it is measured in, a line of the readings
 * against the target, and every reading with its date folded beneath it. A
 * goal with no unit shows only the way to give it one, which the page draws in
 * its row of add lines and mounts this with `startEditing` from (plan #1038).
 * That first unit is the one place a form is used; after it the unit and the
 * target are edited in the line beside the heading.
 */
export function GoalNumber({
  goalId,
  unit,
  target,
  readings,
  today,
  startEditing = false,
  onClose,
}: {
  goalId: string;
  unit: string | null;
  target: number | null;
  /** Oldest first. */
  readings: Reading[];
  today: string;
  /** Open with the form for choosing a unit showing. */
  startEditing?: boolean;
  /** Called when that form closes on a goal still not measured. */
  onClose?: () => void;
}) {
  const [editing, setEditing] = useState(startEditing);

  if (!unit && readings.length === 0) {
    return editing ? (
      <MeasureForm
        goalId={goalId}
        onClose={() => {
          setEditing(false);
          onClose?.();
        }}
      />
    ) : (
      <AddTrigger
        label="Track a number, such as a balance or a weight"
        onClick={() => setEditing(true)}
      />
    );
  }

  const movement = movementLine(readings, { unit, target }, (day) => formatDay(day));

  return (
    <section aria-labelledby="number-heading" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <h2 id="number-heading" className="text-ui font-semibold text-ink">
          The number
        </h2>
        <MeasureLine goalId={goalId} unit={unit} target={target} />
      </div>
      <Card>
        {readings.length > 0 && (
          <div className="space-y-2 px-3 pt-3">
            {movement && <p className="text-small text-ink-muted">{movement}</p>}
            <ReadingLine readings={readings} unit={unit} target={target} />
          </div>
        )}
        {unit && <AddReading goalId={goalId} today={today} />}
        {readings.length > 0 && <ReadingList readings={readings} unit={unit} />}
      </Card>
    </section>
  );
}

/**
 * The unit and the target, edited where they are read beside the heading
 * (law 12). Both sit in one form, so changing either sends the other as it
 * stands. Commit is on Enter or on leaving the line, and only when something
 * changed; moving from the unit to the target does not save in between.
 * Escape puts both back. Clearing the unit stops the measuring and
 * keeps the readings, and typing one again starts it again.
 */
function MeasureLine({
  goalId,
  unit,
  target,
}: {
  goalId: string;
  unit: string | null;
  target: number | null;
}) {
  const [state, save, saving] = useActionState(setMeasureAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const committed = { unit: unit ?? '', target: target === null ? '' : String(target) };

  function commit() {
    const form = formRef.current;
    if (!form || saving) return;
    const data = new FormData(form);
    const changed =
      String(data.get('unit') ?? '').trim() !== committed.unit ||
      (data.has('target') && String(data.get('target') ?? '').trim() !== committed.target);
    if (changed) form.requestSubmit();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      // Two fields and no submit button, so the browser will not submit on
      // Enter by itself.
      event.preventDefault();
      commit();
      return;
    }
    if (event.key !== 'Escape') return;
    const form = formRef.current;
    if (!form) return;
    for (const name of ['unit', 'target'] as const) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLInputElement) field.value = committed[name];
    }
    event.currentTarget.blur();
  }

  // Sized to what is typed, so the line reads as a sentence rather than a row
  // of boxes.
  const fit = 'field-sizing-content w-auto min-w-8 max-w-48';

  return (
    <form
      ref={formRef}
      action={save}
      // A fresh key after each save puts the saved values back as the defaults.
      key={`${committed.unit}|${committed.target}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) commit();
      }}
      className="flex flex-wrap items-baseline gap-x-1 text-small text-ink-muted"
    >
      <input type="hidden" name="goalId" value={goalId} />
      <span>{unit ? 'In' : 'No longer measured. Measure it again in'}</span>
      <InlineInput
        name="unit"
        maxLength={UNIT_MAX}
        defaultValue={committed.unit}
        placeholder={unit ? 'no unit' : 'such as $ or lb'}
        aria-label="What the number is measured in. Clear it to stop measuring; the readings are kept."
        onKeyDown={onKeyDown}
        disabled={saving}
        className={fit}
      />
      {unit && (
        <>
          <span>aiming for</span>
          <InlineInput
            name="target"
            inputMode="decimal"
            defaultValue={committed.target}
            placeholder="no target"
            aria-label="The number you are aiming for"
            onKeyDown={onKeyDown}
            disabled={saving}
            className={cn(fit, 'tabular')}
          />
        </>
      )}
      {state.error && <span className="w-full text-small text-danger">{state.error}</span>}
    </form>
  );
}

/** The first unit and target, for a goal not measured yet. */
function MeasureForm({ goalId, onClose }: { goalId: string; onClose: () => void }) {
  const [state, save, saving] = useActionState(async (prev: ReadingActionState, form: FormData) => {
    const next = await setMeasureAction(prev, form);
    if (next.done) onClose();
    return next;
  }, initial);
  return (
    <Card>
      <form
        action={save}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        className="flex flex-wrap items-center gap-2 px-3 py-2"
      >
        <input type="hidden" name="goalId" value={goalId} />
        <Input
          name="unit"
          autoFocus
          maxLength={UNIT_MAX}
          placeholder="Unit, such as $ or lb"
          aria-label="What the number is measured in"
          className="w-44"
        />
        <Input
          name="target"
          inputMode="decimal"
          placeholder="Target (optional)"
          aria-label="The number you are aiming for"
          className="w-40"
        />
        {state.error && <span className="text-small text-danger">{state.error}</span>}
        <span className="ml-auto flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </span>
      </form>
    </Card>
  );
}

/** Adding a reading, one line until it is wanted (law 14). */
function AddReading({ goalId, today }: { goalId: string; today: string }) {
  const [adding, setAdding] = useState(false);
  return adding ? (
    <ReadingForm goalId={goalId} today={today} onClose={() => setAdding(false)} />
  ) : (
    <div className="border-t border-border px-3 py-1.5 first:border-t-0">
      <AddTrigger label="Add a reading" onClick={() => setAdding(true)} />
    </div>
  );
}

function ReadingForm({
  goalId,
  today,
  onClose,
}: {
  goalId: string;
  today: string;
  onClose: () => void;
}) {
  const [state, add, adding] = useActionState(async (prev: ReadingActionState, form: FormData) => {
    const next = await addReadingAction(prev, form);
    if (next.done) onClose();
    return next;
  }, initial);
  return (
    <form
      action={add}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 first:border-t-0"
    >
      <input type="hidden" name="goalId" value={goalId} />
      <Input
        name="value"
        inputMode="decimal"
        required
        autoFocus
        placeholder="New reading"
        aria-label="The number today"
        className="w-36"
      />
      <Input
        type="date"
        name="readOn"
        defaultValue={today}
        max={today}
        aria-label="The day it was read"
        className="w-auto"
      />
      <InlineInput
        name="note"
        maxLength={READING_NOTE_MAX}
        placeholder="Note (optional)"
        aria-label="A note on this reading"
        className="min-w-32 flex-1"
      />
      <span className="flex items-center gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={adding}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={adding}>
          {adding ? 'Adding…' : 'Add reading'}
        </Button>
      </span>
      {state.error && <p className="w-full text-small text-danger">{state.error}</p>}
    </form>
  );
}

function ReadingList({ readings, unit }: { readings: Reading[]; unit: string | null }) {
  const toast = useToast();
  const remove = async (form: FormData) => {
    const result = await deleteReadingAction(form);
    if (result.error) toast({ text: result.error });
  };
  const latest = readings[readings.length - 1];
  // Folded, because the chart above already draws every one of these (law
  // 10). The closed line carries the count and the latest, so opening it is
  // for correcting a reading rather than for reading them.
  return (
    <div className="border-t border-border px-3 py-1.5">
      <Disclosure
        title={`${readings.length} ${readings.length === 1 ? 'reading' : 'readings'}`}
        meta={`latest ${formatReading(latest.value, unit)} on ${formatDay(latest.readOn)}`}
      >
        <ul aria-label="Every reading" className="divide-y divide-border">
          {[...readings].reverse().map((reading) => (
            <li key={reading.id} className="flex items-center gap-3 py-1.5">
              <span className="tabular w-24 shrink-0 text-small text-ink-muted">
                {formatDay(reading.readOn, true)}
              </span>
              <span className="tabular shrink-0 text-ui text-ink">
                {formatReading(reading.value, unit)}
              </span>
              <span className="min-w-0 flex-1 truncate text-small text-ink-muted">
                {reading.note ?? (reading.captureId ? 'From the capture box' : '')}
              </span>
              <ActionMenu
                label={`Reading of ${formatDay(reading.readOn, true)} actions`}
                items={[
                  {
                    id: 'delete',
                    label: 'Delete, entered by mistake',
                    destructive: true,
                    confirm: 'Delete this reading?',
                    formAction: remove,
                    formFields: { id: reading.id },
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}

const CHART = { width: 600, height: 160 };

/**
 * The readings as a line against the target. The SVG stretches to the card's
 * width, so the line and the target rule keep a fixed stroke and the points
 * are drawn as HTML on top, where stretching cannot squash them. Pointing
 * anywhere on the chart picks the nearest reading by date and names it in the
 * line underneath; the list below the chart is the table view.
 */
function ReadingLine({
  readings,
  unit,
  target,
}: {
  readings: Reading[];
  unit: string | null;
  target: number | null;
}) {
  const chart = readingChart(readings, target, CHART);
  const [active, setActive] = useState<number | null>(null);
  if (!chart) return null;

  const last = chart.points.length - 1;
  const shown = chart.points[active ?? last];
  const pct = (value: number, of: number) => `${(value / of) * 100}%`;

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * chart.width;
    let best = 0;
    chart.points.forEach((point, index) => {
      if (Math.abs(point.x - x) < Math.abs(chart.points[best].x - x)) best = index;
    });
    setActive(best);
  };

  const first = chart.points[0].reading.readOn;
  const final = chart.points[last].reading.readOn;
  const label =
    `${readings.length} ${readings.length === 1 ? 'reading' : 'readings'} from ` +
    `${formatDay(first, true)} to ${formatDay(final, true)}, latest ` +
    formatReading(chart.points[last].reading.value, unit) +
    (target !== null ? `, target ${formatReading(target, unit)}` : '');

  return (
    <figure className="space-y-1">
      <div className="flex gap-2">
        <div className="tabular flex w-16 shrink-0 flex-col justify-between py-1 text-right text-small text-ink-muted">
          <span>{formatReading(chart.high, unit)}</span>
          <span>{formatReading(chart.low, unit)}</span>
        </div>
        <div
          className="relative h-40 min-w-0 flex-1"
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setActive(null)}
        >
          <svg
            viewBox={`0 0 ${chart.width} ${chart.height}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full text-accent"
            role="img"
            aria-label={label}
          >
            <line
              x1={chart.plot.left}
              x2={chart.plot.right}
              y1={chart.plot.bottom}
              y2={chart.plot.bottom}
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {chart.targetY !== null && (
              <line
                x1={chart.plot.left}
                x2={chart.plot.right}
                y1={chart.targetY}
                y2={chart.targetY}
                className="stroke-ink-muted"
                strokeWidth={1}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {chart.path && (
              <path
                d={chart.path}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {active !== null && (
              <line
                x1={shown.x}
                x2={shown.x}
                y1={chart.plot.top}
                y2={chart.plot.bottom}
                className="stroke-border-strong"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {chart.points.map((point, index) => (
            <span
              key={point.reading.id}
              aria-hidden
              className={cn(
                'absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface',
                index === (active ?? last) && 'size-2.5',
              )}
              style={{ left: pct(point.x, chart.width), top: pct(point.y, chart.height) }}
            />
          ))}
        </div>
      </div>
      <figcaption className="flex flex-wrap justify-between gap-x-3 pl-18 text-small text-ink-muted">
        <span className="tabular text-ink">
          {formatDay(shown.reading.readOn, true)}: {formatReading(shown.reading.value, unit)}
        </span>
        {target !== null && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="w-4 border-t border-dashed border-ink-muted" />
            Target {formatReading(target, unit)}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
