'use client';

import { Paperclip, Plus, Undo2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { ModuleMark } from '@/components/ui/module-mark';
import { PaidCostsProvider, PaidHint } from '@/components/ui/paid-hint';
import { Kbd } from '@/components/shell/key-hints';
import type { CaptureAction } from '@/lib/capture/actions';
import { capturePartLabel, filedMessage, type FiledCapture } from '@/lib/capture/place';
import {
  CAPTURE_PLACE_LABELS,
  CAPTURE_PLACE_MODULE,
  type CapturePlace,
  type CaptureSort,
} from '@/lib/capture/sort';
import type { PaidCosts } from '@/lib/core/spend/paid-actions';

/**
 * The pieces of the capture panel that draw without a server: the header,
 * and the one box (plan #1581) with its line saying where Dash will put what
 * you typed and the list of where each thing went. The panel in
 * components/shell/capture.tsx feeds them; the gallery feeds them fixtures.
 */

/** The panel's top row: whose it is, the other actions one press away, and esc. */
export function CaptureHeader({
  action,
  actions,
  onSwitch,
}: {
  action: CaptureAction;
  actions: readonly CaptureAction[];
  onSwitch: (action: CaptureAction) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      {/* Whose workspace the result belongs to, said the way every other
          row in the shell says it. The one box belongs to none, so its
          mark is the home key. */}
      <ModuleMark module={action.module} size="sm" />
      <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">{action.label}</span>
      {/* The other things this box can take, one press away, so the header
          button and ⌥C reach every action and not only the default one. */}
      <span className="flex shrink-0 items-center gap-1">
        {actions
          .filter((other) => other.id !== action.id)
          .map((other) => (
            <button
              key={other.id}
              type="button"
              onClick={() => onSwitch(other)}
              title={other.label}
              aria-label={other.label}
              className="press flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-small text-ink-muted transition-colors duration-quick hover:bg-accent-tint hover:text-accent"
            >
              <ModuleMark module={other.module} size="sm" />
              {/* The mark alone on a phone, so the panel's own name keeps its room. */}
              <span className="hidden sm:inline">{other.label}</span>
            </button>
          ))}
      </span>
      {/* `always`: inside an open panel there is no modifier being held. */}
      <Kbd always>esc</Kbd>
    </div>
  );
}

/** What the line under the field knows about the sentence as it stands. */
export type PlaceGuess =
  /** Too short to ask about, or nothing typed. */
  | { state: 'idle' }
  /** Asked, not answered yet. */
  | { state: 'reading' }
  /** Answered: a sort, or null when the call failed. */
  | { state: 'answered'; sort: CaptureSort | null };

const chip =
  'press rounded-full px-2.5 py-1 text-small font-medium transition-colors duration-quick';

/**
 * The line under the field. Sure: where Dash will put it. Unsure, or no
 * answer: the places as chips. A pick overrules either, and pressing the
 * picked chip again takes it back.
 */
export function PlaceLine({
  guess,
  places,
  picked,
  onPick,
}: {
  guess: PlaceGuess;
  /** The places this account is offered. */
  places: readonly CapturePlace[];
  picked: CapturePlace | null;
  onPick: (place: CapturePlace | null) => void;
}) {
  if (guess.state === 'idle' && !picked) return null;
  const sort = guess.state === 'answered' ? guess.sort : null;
  const sure = !picked && sort?.sure && sort.parts.length > 0;
  const asking = !picked && guess.state === 'answered' && !sure;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-border px-3 py-2 text-small"
    >
      {picked ? (
        <span className="text-ink-muted">Dash will file this as</span>
      ) : guess.state === 'reading' ? (
        <span className="text-ink-muted">Dash is working out where this goes…</span>
      ) : sure && sort ? (
        <span className="min-w-0 flex-1 text-ink-muted">
          {sort.parts.length === 1 ? 'Dash will file this as ' : `Dash will file this in ${sort.parts.length} places: `}
          {sort.parts.map((part, index) => (
            <span key={index}>
              {index > 0 && (index === sort.parts.length - 1 ? ' and ' : ', ')}
              <span className="font-medium text-ink">{capturePartLabel(part)}</span>
            </span>
          ))}
        </span>
      ) : (
        <span className="text-ink-muted">Dash is not sure where this goes. Which is it?</span>
      )}
      {(asking || picked) && (
        <span className="flex w-full flex-wrap gap-1.5">
          {places.map((place) => {
          const on = picked === place;
          return (
            <button
              key={place}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(on ? null : place)}
              className={cn(
                chip,
                        'flex items-center gap-1.5 pl-1.5',
                on
                  ? 'bg-accent text-fill-ink ring-1 ring-accent'
                  : 'text-ink-muted ring-1 ring-border hover:bg-accent-tint hover:text-accent',
              )}
            >
              <ModuleMark module={CAPTURE_PLACE_MODULE[place]} size="sm" />
              {CAPTURE_PLACE_LABELS[place]}
            </button>
          );
          })}
        </span>
      )}
      {sure && sort && (
        <button
          type="button"
          onClick={() => onPick(sort.parts[0].place)}
          className="press ml-auto shrink-0 rounded-full px-2 py-1 text-small text-ink-muted hover:bg-accent-tint hover:text-accent"
        >
          Change
        </button>
      )}
    </div>
  );
}

/** The foot of the box: what was just done, and File it with its cost. */
export function CaptureFoot({
  message,
  pending,
  costs,
  files,
}: {
  message?: string;
  pending: boolean;
  costs: PaidCosts;
  /** "Add a file" and the chips of what it added (plan #1714), first in the row. */
  files?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-border px-3 py-2">
      {/* A row of its own, so the chips it adds sit under the button and the
          hint below stays level with File it. */}
      {files && <div className="basis-full">{files}</div>}
      {/* No keys to press on a phone, so the hint is for a keyboard only. */}
      <span aria-hidden className="hidden text-small text-ink-ghost sm:inline">
        <Kbd always>↵</Kbd> files · <Kbd always>⇧↵</Kbd> new line
      </span>
      <span className="ml-auto flex items-center gap-2">
        <span role="status" aria-live="polite" className="text-small text-ink-muted">
          {message}
        </span>
        <Button type="submit" size="sm" pending={pending}>
          <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
          {pending ? 'Filing…' : 'File it'}
        </Button>
        <PaidCostsProvider costs={costs}>
          <PaidHint action="app/capture-actions.ts#fileCaptureBox" what="Cost of filing it" align="end" />
        </PaidCostsProvider>
      </span>
    </div>
  );
}

/**
 * Where each thing went, newest first, each with its Undo. A goal update
 * shows the lines Goals filed it as, each with its own Undo (`goalLines`),
 * since one sentence can close a step and log progress on another.
 */
export function FiledCaptures({
  filed,
  busy,
  error,
  onUndo,
  goalLines,
}: {
  filed: readonly FiledCapture[];
  /** The record being undone. */
  busy: string | null;
  error: string | null;
  onUndo: (item: FiledCapture) => void;
  goalLines: (item: FiledCapture) => React.ReactNode;
}) {
  if (filed.length === 0) return null;
  const standing = filed.filter((item) =>
    item.goals ? item.goals.entries.some((entry) => !entry.undone_at) || item.goals.entries.length === 0 : !item.undoneAt,
  );
  return (
    <div className="max-h-[40vh] overflow-y-auto border-t border-border">
      <p role="status" aria-live="polite" className="px-3 pt-2 text-small text-ink-muted">
        {standing.length === 0 ? 'Everything filed here has been undone.' : filedMessage(standing)}
      </p>
      <ul className="divide-y divide-border">
        {filed.map((item, index) => (
          <li key={`${item.actionId ?? item.goals?.captureId ?? index}-${index}`} className="px-3 py-2 text-small">
            <div className="flex items-start gap-2">
              <ModuleMark module={CAPTURE_PLACE_MODULE[item.place]} size="sm" className="mt-1" />
              <span className="min-w-0 flex-1 py-0.5">
                <span className={cn('flex items-baseline gap-1.5 font-medium', item.undoneAt ? 'text-ink-muted' : 'text-ink')}>
                  <span className="min-w-0">{item.where}</span>
                  {item.files ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 font-normal text-ink-muted tabular-nums">
                      <Paperclip className="size-3" strokeWidth={1.75} aria-hidden />
                      <span className="sr-only">with </span>
                      {item.files}
                      <span className="sr-only">{item.files === 1 ? ' file' : ' files'}</span>
                    </span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    'block truncate',
                    item.undoneAt ? 'text-ink-muted line-through' : 'text-ink-muted',
                  )}
                >
                  {item.text}
                </span>
              </span>
              {item.goals ? null : item.undoneAt ? (
                <span className="shrink-0 px-2.5 py-1 text-ink-muted">Undone</span>
              ) : item.actionId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  pending={busy === item.actionId}
                  onClick={() => onUndo(item)}
                >
                  <Undo2 className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Undo
                </Button>
              ) : null}
            </div>
            {item.goals && <div className="pl-8">{goalLines(item)}</div>}
          </li>
        ))}
      </ul>
      {error && (
        <div className="px-3 pb-2">
          <FieldError>{error}</FieldError>
        </div>
      )}
    </div>
  );
}
