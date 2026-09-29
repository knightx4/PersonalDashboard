'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldError, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { errandAreas, handTaskToDash } from '@/app/todo/actions';
import type { Task } from '@/lib/todo/tasks/model';

/**
 * Hand a task to Dash as an errand (plan #1263), opened in place of the row
 * the way Edit everything is. It asks the two things an errand needs that a
 * task may not have: which Goals area it goes in, starting on the one Add an
 * errand would pick, and the date it is due by, starting on the task's own.
 * The title and notes go across as they are.
 *
 * What the press did, Dash started or why not, comes back as a toast and the
 * row closes; a refusal stays in the form.
 */
export function HandToDash({
  task,
  linked,
  onDone,
}: {
  task: Task;
  /** Whether the task is already about something, which the link then keeps. */
  linked: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const [areas, setAreas] = useState<{ id: string; name: string }[] | null>(null);
  const [areaId, setAreaId] = useState('');
  const [dueOn, setDueOn] = useState(task.dueOn ?? (task.dueAt ? task.dueAt.slice(0, 10) : ''));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    void errandAreas().then((result) => {
      if (!live) return;
      setAreas(result.areas);
      setAreaId(result.defaultAreaId ?? '');
      setError(result.error);
    });
    return () => {
      live = false;
    };
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      const result = await handTaskToDash(task.id, areaId, dueOn);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.message) toast({ text: result.message });
      onDone();
    });
  }

  const noAreas = areas !== null && areas.length === 0;

  return (
    // The same well as Edit everything: the row unfolded, not a second sheet.
    <form
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDone();
      }}
      className="card-pad-dense space-y-3 rounded-card bg-canvas"
    >
      <p className="text-small text-ink-muted">
        Dash takes this as an errand on Goals and starts on it now
        {task.body ? ', with its notes as the detail' : ''}. The task is ticked off
        {linked ? ' with a line in its notes saying where it went.' : ' and links to the errand.'}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`errand-area-${task.id}`} label="Area">
          <Select
            id={`errand-area-${task.id}`}
            value={areaId}
            onChange={(event) => setAreaId(event.target.value)}
            disabled={areas === null || noAreas}
            required
          >
            {areas === null && <option value="">Loading…</option>}
            {noAreas && <option value="">No areas yet</option>}
            {areas?.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id={`errand-due-${task.id}`} label="Due by">
          <Input
            id={`errand-due-${task.id}`}
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            required
          />
        </Field>
      </div>

      <FieldError>
        {noAreas && !error ? 'Add an area on Goals first; an errand sits under one.' : error}
      </FieldError>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !areaId || !dueOn}>
          {pending ? 'Handing it to Dash…' : 'Hand it to Dash'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
