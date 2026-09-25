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
import {
  setHelpKindsAction,
  turnDownHelpAction,
  type HelpKindsActionState,
} from './help-actions';

const initial: HelpKindsActionState = {};

/**
 * The kinds of weekly help a goal asks for (plan #1027): each chosen kind
 * with its note, and a form to tick kinds and say what to look for. A goal
 * with none shows only the way to choose some, which the page draws in its row
 * of add lines and mounts this with `startEditing` from (plan #1038).
 *
 * Kinds Claude proposed when it mapped the goal (plan #1029) show in place of
 * the chosen ones, to approve as they stand, change or turn down. Claude only
 * proposes for a goal whose help has never been saved, so the two lists do not
 * meet.
 */
export function GoalHelp({
  goalId,
  helpKinds,
  proposedHelpKinds = [],
  startEditing = false,
  onClose,
}: {
  goalId: string;
  helpKinds: HelpKindChoice[];
  /** Kinds Claude proposed, waiting for you. */
  proposedHelpKinds?: HelpKindChoice[];
  /** Open with the form showing. */
  startEditing?: boolean;
  /** Called when the form closes. */
  onClose?: () => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const proposed = helpKinds.length === 0 && proposedHelpKinds.length > 0;
  const shown = proposed ? proposedHelpKinds : helpKinds;

  if (shown.length === 0 && !editing) {
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
        {proposed && !editing && (
          <span className="text-small text-ink-muted">Proposed by Claude</span>
        )}
        {!editing && !proposed && (
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
        <HelpForm
          goalId={goalId}
          helpKinds={shown}
          onClose={() => {
            setEditing(false);
            onClose?.();
          }}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {shown.map(({ kind, note }) => (
              <li key={kind} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                <span className="text-body text-ink">{HELP_KIND_LABELS[kind]}</span>
                {note && <span className="text-small text-ink-muted">{note}</span>}
              </li>
            ))}
          </ul>
          {proposed && (
            <ProposalButtons
              goalId={goalId}
              proposal={proposedHelpKinds}
              onChange={() => setEditing(true)}
            />
          )}
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

/**
 * Approve, Change and Turn down under a proposal (plan #1029). Approve saves
 * the proposed kinds and notes through the same action as the form, so it
 * settles the goal's help the same way.
 */
function ProposalButtons({
  goalId,
  proposal,
  onChange,
}: {
  goalId: string;
  proposal: HelpKindChoice[];
  onChange: () => void;
}) {
  const [approved, approve, approving] = useActionState(setHelpKindsAction, initial);
  const [turned, turnDown, turning] = useActionState(turnDownHelpAction, initial);
  const busy = approving || turning;
  const error = approved.error ?? turned.error;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
      <form action={approve}>
        <input type="hidden" name="goalId" value={goalId} />
        {proposal.map(({ kind, note }) => (
          <span key={kind}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name={`note:${kind}`} value={note ?? ''} />
          </span>
        ))}
        <Button type="submit" size="sm" pending={approving} disabled={busy}>
          Approve
        </Button>
      </form>
      <Button type="button" size="sm" variant="ghost" onClick={onChange} disabled={busy}>
        Change
      </Button>
      <form action={turnDown}>
        <input type="hidden" name="goalId" value={goalId} />
        <Button type="submit" size="sm" variant="ghost" pending={turning} disabled={busy}>
          Turn down
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
