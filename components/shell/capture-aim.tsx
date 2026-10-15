'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { ToggleChip } from '@/components/ui/chip';
import { FieldError } from '@/components/ui/field';
import { Kbd } from '@/components/ui/kbd';
import { ModuleMark } from '@/components/ui/module-mark';
import type { CaptureAim, CaptureKind, CaptureUnder } from '@/lib/capture/actions';
import { isCalendarDay, type CaptureDay } from '@/lib/capture/todo';
import { roleName, type CaptureSortRole } from '@/lib/capture/sort';
import type { RelativeDay } from '@/lib/todo/tasks/model';
import type { PaidAction } from '@/lib/core/spend/paid-actions';

/**
 * Capture aimed at a kind (plan #1950.1): what an Add button on a list opens.
 *
 * The context is its own small module so `AddTrigger` in components/ui can
 * reach it without pulling the whole capture panel into every page that
 * draws a trigger. Outside the shell (the gallery, a test) there is no
 * provider, and `useCaptureAim` answers null so the trigger falls back to
 * its own `onClick`.
 */
export const CaptureAimContext = createContext<((aim: CaptureAim) => void) | null>(null);

/** Open capture aimed at a kind, or null outside the shell. */
export function useCaptureAim(): ((aim: CaptureAim) => void) | null {
  return useContext(CaptureAimContext);
}

/**
 * A day, picked or unpicked in one press.
 *
 * A toggle rather than a pair of radios, the same as the chips on /todo:
 * picking Today and changing your mind has to cost one press, not a trip to a
 * date field to clear it.
 */
export function DayChip({
  label,
  day,
  picked,
  onPick,
}: {
  label: string;
  day: RelativeDay;
  picked: CaptureDay;
  onPick: (day: CaptureDay) => void;
}) {
  const on = picked === day;

  return (
    <ToggleChip on={on} onClick={() => onPick(on ? '' : day)}>
      {label}
    </ToggleChip>
  );
}

/**
 * The days a todo can be added for: Today and Tomorrow one press each, and a
 * date field for the rest, the shape the add form on /todo uses. The chips
 * send the word rather than a date, because the shell is not handed the
 * account's today (lib/capture/todo.ts).
 */
export function DayChips({ day, onDay }: { day: CaptureDay; onDay: (day: CaptureDay) => void }) {
  return (
    <>
      <DayChip label="Today" day="today" picked={day} onPick={onDay} />
      <DayChip label="Tomorrow" day="tomorrow" picked={day} onPick={onDay} />
      {/* Unframed and quiet, so a row of chips stays a row of chips rather
          than growing a boxed field in the middle of it. */}
      <input
        type="date"
        aria-label="A specific day"
        value={isCalendarDay(day) ? day : ''}
        onChange={(event) => onDay(event.target.value)}
        className={cn(
          // ui-ok: fixed-control-height -- sits in a row of Chips, which are h-7, and matches them from
          // sm up; on a phone it is a full press target, since a field cannot carry press-area's ::after.
          'tabular h-11 rounded-control sm:h-7 bg-transparent px-2 text-small outline-none transition-colors duration-quick',
          'focus:ring-1 focus:ring-accent/40',
          isCalendarDay(day) ? 'text-ink' : 'text-ink-muted',
        )}
      />
    </>
  );
}

/**
 * The aimed panel's body: the kind's name, its title field, the one more
 * thing it needs, and the Add button. No sort line and no place chips, since
 * pressing Add on a list already said where it goes. Drawn by the live panel
 * in components/shell/capture.tsx and by the gallery from fixtures.
 */
export function AimedCaptureForm({
  kind,
  role,
  under,
  page,
  files,
  text,
  onText,
  day,
  onDay,
  pending,
  error,
  fieldRef,
  onSubmit,
  paid,
  attached,
  tools,
}: {
  kind: CaptureKind;
  /** The role a note goes on, which the page aiming it already knew. */
  role?: CaptureSortRole;
  /** The area, row or module it goes in, which the page aiming it knew. */
  under?: CaptureUnder;
  /** The page a note for Dev is about. */
  page?: string;
  /** "Add a file", for a kind that takes files. */
  files?: ReactNode;
  text: string;
  onText: (text: string) => void;
  day: CaptureDay;
  onDay: (day: CaptureDay) => void;
  pending: boolean;
  error: string | null;
  fieldRef?: (node: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onSubmit: () => void;
  /**
   * For a kind whose press makes a model call: the action it calls, so Add
   * is Dash's press with the cost beside it. The figure comes from the
   * PaidCostsProvider around the form.
   */
  paid?: { action: PaidAction; what: string };
  /**
   * What takes the field's place while it is there (plan #1950.3.2): a
   * receipt photo, the barcode viewfinder, or the book a scan named.
   */
  attached?: React.ReactNode;
  /** The camera step's button, at the start of the foot (capture-camera.tsx). */
  tools?: React.ReactNode;
}) {
  const field = 'w-full bg-transparent px-3 py-3 text-body text-ink outline-none placeholder:text-ink-ghost';

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ModuleMark module={kind.module} size="sm" />
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">{kind.label}</span>
        {/* `always`: inside an open panel there is no modifier being held. */}
        <Kbd always>esc</Kbd>
      </div>

      {attached ? (
        attached
      ) : kind.field === 'prose' ? (
        <textarea
          ref={fieldRef}
          value={text}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder={kind.placeholder}
          aria-label={kind.label}
          rows={3}
          // No focus ring: the panel focuses this on open, so the global ring
          // would be drawn permanently rather than ever indicating anything.
          data-focus-ring="none"
          className={cn(field, 'resize-none')}
        />
      ) : (
        <input
          ref={fieldRef}
          value={text}
          onChange={(event) => onText(event.target.value)}
          placeholder={kind.placeholder}
          aria-label={kind.label}
          data-focus-ring="none"
          className={field}
        />
      )}

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-border px-3 py-2">
        {tools}
        {kind.needs === 'day' && <DayChips day={day} onDay={onDay} />}
        {/* What it goes on, and any files, stacked on the panel's left edge
            so they line up at every width; Add stays on the right. */}
        {((kind.needs === 'role' && role) || under || page || files) && (
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
            {kind.needs === 'role' && role && (
              <span className="min-w-0 max-w-full truncate text-small text-ink-muted">
                On <span className="text-ink">{roleName(role)}</span>
              </span>
            )}
            {under && (
              <span className="min-w-0 max-w-full truncate text-small text-ink-muted">
                {kind.id === 'plan-step' ? 'Under' : 'In'} <span className="text-ink">{under.title}</span>
              </span>
            )}
            {page && (
              <span className="min-w-0 max-w-full truncate text-small text-ink-muted">
                From <span className="tabular text-ink">{page}</span>
              </span>
            )}
            {files}
          </div>
        )}
        <span className="ml-auto flex items-center gap-2 self-end">
          {paid ? (
            <DashAction
              type="submit"
              size="sm"
              pending={pending}
              paid={paid.action}
              what={paid.what}
              align="end"
              hintFirst
            >
              {pending ? 'Adding…' : 'Add'}
            </DashAction>
          ) : (
            <Button type="submit" size="sm" pending={pending}>
              <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
              {pending ? 'Adding…' : 'Add'}
            </Button>
          )}
        </span>
      </div>

      {error && (
        <div className="px-3 pb-2">
          <FieldError>{error}</FieldError>
        </div>
      )}
    </>
  );
}
