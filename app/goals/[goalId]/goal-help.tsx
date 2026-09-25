'use client';

import { useActionState, useState } from 'react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineInput } from '@/components/ui/field';
import {
  HELP_KINDS,
  HELP_KIND_LABELS,
  HELP_NOTE_MAX,
  type HelpKindChoice,
} from '@/lib/goals/help-kinds';
import { setHelpKindsAction, type HelpKindsActionState } from './help-actions';

const initial: HelpKindsActionState = {};

/**
 * The kinds of weekly help a goal asks for (plan #1027): each chosen kind
 * with its note, and a form to tick kinds and say what to look for. A goal
 * with none shows only the way to choose some.
 */
export function GoalHelp({ goalId, helpKinds }: { goalId: string; helpKinds: HelpKindChoice[] }) {
  const [editing, setEditing] = useState(false);

  if (helpKinds.length === 0 && !editing) {
    return (
      <AddTrigger
        label="Choose the help the weekly run finds, such as events or reading"
        onClick={() => setEditing(true)}
      />
    );
  }

  return (
    <section aria-labelledby="help-heading" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <h2 id="help-heading" className="text-ui font-semibold text-ink">
          Weekly help
        </h2>
        {!editing && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => setEditing(true)}
          >
            Change
          </Button>
        )}
      </div>
      {editing ? (
        <HelpForm goalId={goalId} helpKinds={helpKinds} onClose={() => setEditing(false)} />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {helpKinds.map(({ kind, note }) => (
              <li key={kind} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                <span className="text-body text-ink">{HELP_KIND_LABELS[kind]}</span>
                {note && <span className="text-small text-ink-muted">{note}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function HelpForm({
  goalId,
  helpKinds,
  onClose,
}: {
  goalId: string;
  helpKinds: HelpKindChoice[];
  onClose: () => void;
}) {
  const chosen = new Map(helpKinds.map((choice) => [choice.kind, choice.note]));
  const [ticked, setTicked] = useState(() => new Set(chosen.keys()));
  const [state, save, saving] = useActionState(
    async (prev: HelpKindsActionState, form: FormData) => {
      const next = await setHelpKindsAction(prev, form);
      if (next.done) onClose();
      return next;
    },
    initial,
  );

  return (
    <Card>
      <form
        action={save}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <input type="hidden" name="goalId" value={goalId} />
        <ul className="divide-y divide-border">
          {HELP_KINDS.map((kind) => (
            <li key={kind} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <label className="flex w-44 cursor-pointer items-center gap-2 text-body text-ink">
                <input
                  type="checkbox"
                  name="kind"
                  value={kind}
                  checked={ticked.has(kind)}
                  onChange={(event) => {
                    const next = new Set(ticked);
                    if (event.target.checked) next.add(kind);
                    else next.delete(kind);
                    setTicked(next);
                  }}
                  className="size-4 rounded border-border text-accent focus:ring-accent/30"
                />
                {HELP_KIND_LABELS[kind]}
              </label>
              {ticked.has(kind) && (
                <InlineInput
                  name={`note:${kind}`}
                  maxLength={HELP_NOTE_MAX}
                  defaultValue={chosen.get(kind) ?? ''}
                  placeholder="What to look for (optional)"
                  aria-label={`What to look for in ${HELP_KIND_LABELS[kind].toLowerCase()}`}
                  className="min-w-0 flex-1"
                />
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          {state.error && <span className="text-small text-danger">{state.error}</span>}
          <span className="ml-auto flex items-center gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </span>
        </div>
      </form>
    </Card>
  );
}
