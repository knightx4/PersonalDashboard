'use client';

import { useState, useTransition } from 'react';
import { Pencil, Undo2 } from 'lucide-react';
import { DayChip } from '@/components/goals/log-done';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { hoursText, type HoursEntry } from '@/lib/goals/hours';
import {
  changeProgressEntry,
  restoreLoggedProgress,
  undoLoggedProgress,
  type ProgressEntryChange,
} from '../progress-actions';

/** What the row was drawn with, for the gallery. */
export type EntryRowDrawn = { editing?: boolean; error?: string };

/**
 * One logged entry in a day's drawer, with Change and Undo beside it (plan
 * #2907.3). Both stay in view, since a phone has no hover. Change turns the
 * row into its own form: the hours, the day and the note, saved in place.
 * Undo takes the entry back at once and says so in a toast, whose Restore
 * brings it back. A refusal from either is said under the row it came from.
 */
export function HoursEntryRow({
  entry,
  day,
  today,
  earliest,
  onChanged,
  drawn,
}: {
  entry: HoursEntry;
  /** The day the drawer is on, which is the entry's day. */
  day: string;
  today: string;
  earliest: string;
  /** Read the day again and refresh the page's bars and charts. */
  onChanged: () => void;
  drawn?: EntryRowDrawn;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(drawn?.editing ?? false);
  const [error, setError] = useState<string | null>(drawn?.error ?? null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<'save' | 'undo' | null>(null);

  function undo() {
    setError(null);
    setBusy('undo');
    start(async () => {
      const result = await undoLoggedProgress(entry.id);
      setBusy(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast({
        text: `${hoursText(entry.hours)} off ${entry.goalTitle}`,
        undoLabel: 'Restore',
        undone: 'Brought it back',
        undo: async () => {
          const back = await restoreLoggedProgress(entry.id);
          if (back.error) throw new Error(back.error);
          onChanged();
        },
      });
      onChanged();
    });
  }

  function save(change: Omit<ProgressEntryChange, 'id'> | null) {
    if (!change) {
      setEditing(false);
      return;
    }
    setError(null);
    setBusy('save');
    start(async () => {
      const result = await changeProgressEntry({ id: entry.id, ...change });
      setBusy(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      onChanged();
    });
  }

  return (
    <li className="space-y-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-ui font-medium text-ink">{entry.goalTitle}</p>
        {!editing && (
          <p className="tabular shrink-0 text-ui font-semibold text-ink">{hoursText(entry.hours)}</p>
        )}
      </div>
      {editing ? (
        <EntryForm
          entry={entry}
          day={day}
          today={today}
          earliest={earliest}
          saving={busy === 'save'}
          error={error}
          onSave={save}
          onCancel={() => {
            setEditing(false);
            setError(null);
          }}
        />
      ) : (
        <>
          <p className="break-words text-small text-ink-muted">
            {entry.stepTitle && <span>{entry.stepTitle}: </span>}
            {entry.note}
          </p>
          <div className="-ml-1.5 flex gap-1">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="font-normal"
              disabled={pending}
              onClick={() => {
                setError(null);
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
              Change
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="font-normal"
              disabled={pending && busy !== 'undo'}
              pending={busy === 'undo'}
              onClick={undo}
            >
              <Undo2 className="size-3.5" strokeWidth={1.75} aria-hidden />
              Undo
            </Button>
          </div>
          <FieldError>{error}</FieldError>
        </>
      )}
    </li>
  );
}

/** The hours as a person types them: "1.5", "1,5" or ".5". Null when it is not a number above nothing. */
export function readHours(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() && Number.isFinite(value) && value > 0 ? value : null;
}

function EntryForm({
  entry,
  day,
  today,
  earliest,
  saving,
  error,
  onSave,
  onCancel,
}: {
  entry: HoursEntry;
  day: string;
  today: string;
  earliest: string;
  saving: boolean;
  error: string | null;
  onSave: (change: Omit<ProgressEntryChange, 'id'> | null) => void;
  onCancel: () => void;
}) {
  const [hours, setHours] = useState(String(entry.hours));
  const [newDay, setNewDay] = useState(day);
  const [note, setNote] = useState(entry.note);
  const [problem, setProblem] = useState<string | null>(null);
  const base = `entry-${entry.id}`;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const amount = readHours(hours);
    if (amount === null || amount > 24) {
      setProblem('Hours have to be a number above 0 and at most 24. Undo takes an entry back.');
      return;
    }
    if (!note.trim()) {
      setProblem('Write what was done.');
      return;
    }
    setProblem(null);
    const change: Omit<ProgressEntryChange, 'id'> = {};
    // Only a changed amount is sent, so an entry logged in minutes keeps its unit.
    if (amount !== entry.hours) Object.assign(change, { quantity: amount, unit: 'h' });
    if (newDay !== day) change.happenedOn = newDay;
    if (note.trim() !== entry.note) change.text = note.trim();
    onSave(Object.keys(change).length > 0 ? change : null);
  }

  const shown = problem ?? error;
  return (
    <form onSubmit={submit} className="space-y-2" aria-label={`Change ${entry.goalTitle}`}>
      {/* The editor keeps the row's own size: hours and day on one line at
          one height, the hours carrying their "h", so no captions are drawn
          (plan #2907.3's critic, round 1). The labels stay for a screen reader. */}
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`${base}-hours`} className="sr-only">
          Hours
        </Label>
        <span className="relative inline-flex w-24 items-center">
          <Input
            id={`${base}-hours`}
            inputMode="decimal"
            className="tabular pr-7 max-sm:min-h-11"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            aria-invalid={problem?.startsWith('Hours') || undefined}
          />
          <span aria-hidden className="pointer-events-none absolute right-2.5 text-ui text-ink-muted">
            h
          </span>
        </span>
        <DayChip
          day={newDay}
          today={today}
          earliest={earliest}
          onChange={setNewDay}
          className="h-(--control-h) border-control"
        />
      </div>
      <Label htmlFor={`${base}-note`} className="sr-only">
        Note
      </Label>
      <Textarea
        id={`${base}-note`}
        className="sm:text-small"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={2000}
      />
      <FieldError>{shown}</FieldError>
      <div className="flex gap-2">
        <Button type="submit" size="sm" pending={saving}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
