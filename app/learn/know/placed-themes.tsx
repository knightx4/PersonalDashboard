'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import type { DestinationGroup } from '@/lib/learn/areas/move';
import { moveTheme, type MoveState } from './move-actions';

/** One theme as the list draws it, with its names already resolved on the server. */
export type ThemeRow = {
  placementId: string;
  name: string;
  basis: string;
  runnerUp: string | null;
  movedByHand: boolean;
  /** Where it sits now, as a destination value (`targetValue`). */
  at: string;
};

const initial: MoveState = {};
const OFF_GRID = 'none';

function formOf(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

function labelOf(value: string, groups: DestinationGroup[]): string {
  for (const group of groups) {
    const option = group.options.find((candidate) => candidate.value === value);
    if (option) return option.label;
  }
  return 'another place';
}

/**
 * The move form for one theme. Reversible, so it does not confirm: it moves
 * the theme, says so in a toast and offers the way back there, the same as
 * the returns buttons in Shopping. The undo sends the old place and the old
 * `moved_by_hand`, so it puts the row back as the placement pass left it.
 */
function MoveForm({
  theme,
  groups,
  onDone,
}: {
  theme: ThemeRow;
  groups: DestinationGroup[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [to, setTo] = useState(theme.at);
  const [state, action, pending] = useActionState(async (prev: MoveState, formData: FormData) => {
    const next = await moveTheme(prev, formData);
    if (!next.error) {
      const moved = String(formData.get('to'));
      toast({
        text:
          moved === OFF_GRID
            ? `Took ${theme.name} off the grid`
            : `Moved ${theme.name} to ${labelOf(moved, groups)}`,
        undo: async () => {
          const undone = await moveTheme(
            initial,
            formOf({
              placementId: theme.placementId,
              to: theme.at,
              byHand: theme.movedByHand ? 'true' : 'false',
            }),
          );
          if (undone.error) throw new Error(undone.error);
        },
      });
      onDone();
    }
    return next;
  }, initial);

  const selectId = `move-${theme.placementId}`;
  return (
    <form action={action} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="placementId" value={theme.placementId} />
      <input type="hidden" name="byHand" value="true" />
      <label htmlFor={selectId} className="sr-only">
        Move {theme.name} to
      </label>
      <Select
        id={selectId}
        name="to"
        value={to}
        onChange={(event) => setTo(event.target.value)}
        className="min-w-0 sm:max-w-xs"
        aria-describedby={state.error ? `${selectId}-error` : undefined}
      >
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={OFF_GRID}>Off the grid</option>
      </Select>
      <span className="flex gap-2">
        <Button type="submit" size="sm" pending={pending} disabled={to === theme.at}>
          {pending ? 'Moving…' : 'Move'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </span>
      {state.error && <FieldError id={`${selectId}-error`}>{state.error}</FieldError>}
    </form>
  );
}

/**
 * The themes in an opened place, strongest first. One move form open at a
 * time, so a field of a hundred and thirty themes draws one select rather
 * than a hundred and thirty.
 */
export function PlacedThemes({
  themes,
  groups,
}: {
  themes: ThemeRow[];
  groups: DestinationGroup[];
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ul className="divide-y divide-border">
      {themes.map((theme) => (
        <li key={theme.placementId} className="py-2 first:pt-0 last:pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-ui font-medium text-ink">{theme.name}</p>
              <p className="text-small text-ink-muted">
                {theme.movedByHand
                  ? `You moved it here. The placement pass had said: ${theme.basis}`
                  : theme.basis}
              </p>
              {theme.runnerUp && (
                <p className="text-small text-ink-muted">Runner-up: {theme.runnerUp}</p>
              )}
            </div>
            {open !== theme.placementId && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="shrink-0"
                onClick={() => setOpen(theme.placementId)}
              >
                Move
              </Button>
            )}
          </div>
          {open === theme.placementId && (
            <MoveForm theme={theme} groups={groups} onDone={() => setOpen(null)} />
          )}
        </li>
      ))}
    </ul>
  );
}
