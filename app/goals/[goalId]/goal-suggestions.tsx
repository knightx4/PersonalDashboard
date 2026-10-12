'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashCredit } from '@/components/ui/dash-mark';
import { stepHref } from '@/lib/goals/all-goals';
import { formatDay } from '@/lib/goals/dates';
import { HELP_KIND_LABELS, type HelpKindChoice } from '@/lib/goals/help-kinds';
import type { Suggestion } from '@/lib/goals/suggestions';
import {
  addSuggestedStepAction,
  reactToSuggestionAction,
  type SuggestionActionState,
} from '../suggestion-actions';
import { GoalHelp } from './goal-help';

const initial: SuggestionActionState = {};

/**
 * A goal's Suggestions section on its Overview (plan #1739), in place of the
 * weekly help block: a few things you could do next, which Dash keeps each
 * week and tops up in the morning when the list runs dry.
 *
 * A suggested step has Add as step, which makes it a step of yours on the
 * goal and nothing more: it reaches Todo only when you send it there. An
 * event, an opening or something to read has Going, as on the Goals home.
 * Every row has Not for me, which the next week's suggestions follow.
 *
 * Beneath the list, the kinds of help the weekly run looks for, with Change.
 * Kinds Dash proposed are shown to approve as before (goal-help.tsx).
 */
export function GoalSuggestions({
  goalId,
  suggestions,
  helpKinds,
  proposedHelpKinds = [],
}: {
  goalId: string;
  suggestions: Suggestion[];
  /** The help the weekly run looks for; empty when none was chosen. */
  helpKinds: HelpKindChoice[];
  proposedHelpKinds?: HelpKindChoice[];
}) {
  const [changing, setChanging] = useState(false);
  const proposed = helpKinds.length === 0 && proposedHelpKinds.length > 0;

  return (
    <section aria-labelledby="suggestions-heading" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <h2 id="suggestions-heading" className="text-ui font-semibold text-ink">
          Suggestions
        </h2>
        <span className="text-small text-ink-muted">
          <DashCredit />
          From Dash
        </span>
      </div>
      <Card>
        {suggestions.length > 0 ? (
          <ul className="divide-y divide-border">
            {suggestions.map((s) => (
              <SuggestionRow key={s.id} goalId={goalId} suggestion={s} />
            ))}
          </ul>
        ) : (
          <p className="card-pad-x row-pad text-small text-ink-muted">
            Nothing suggested yet. Dash suggests a few next steps each week, and fills an empty
            list the next morning.
          </p>
        )}
        {helpKinds.length > 0 && !changing && (
          <div className="card-pad-x flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-2">
            <p className="min-w-0 flex-1 text-small text-ink-muted">
              Each week Dash also finds {kindList(helpKinds)} for this goal.
            </p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setChanging(true)}>
              Change
            </Button>
          </div>
        )}
      </Card>
      {changing && (
        <GoalHelp goalId={goalId} helpKinds={helpKinds} startEditing onClose={() => setChanging(false)} />
      )}
      {proposed && <GoalHelp goalId={goalId} helpKinds={[]} proposedHelpKinds={proposedHelpKinds} />}
    </section>
  );
}

function SuggestionRow({ goalId, suggestion: s }: { goalId: string; suggestion: Suggestion }) {
  const step = s.kind === 'step';
  const [added, add, adding] = useActionState(addSuggestedStepAction, initial);
  const [went, goGoing, going] = useActionState(reactToSuggestionAction, initial);
  const [declined, decline, declining] = useActionState(reactToSuggestionAction, initial);
  const busy = adding || going || declining;
  const error = added.error ?? went.error ?? declined.error;
  // A suggested step needs no label: the section says what it is.
  const facts = [
    s.kind === 'step' ? null : HELP_KIND_LABELS[s.kind],
    s.happensOn ? formatDay(s.happensOn) : null,
    s.place,
    s.source,
  ]
    .filter(Boolean)
    .join(' · ');

  if (added.stepId) {
    return (
      <li className="card-pad-x row-pad space-y-0.5">
        <p className="text-body break-words text-ink">{s.title}</p>
        <p className="text-small text-positive" role="status">
          Added to the steps.{' '}
          <Link
            href={stepHref(goalId, added.stepId)}
            className="press-area text-accent underline-offset-2 hover:underline"
          >
            Open it
          </Link>
        </p>
      </li>
    );
  }
  if (declined.done) {
    return (
      <li className="card-pad-x row-pad">
        <p className="text-small text-ink-muted" role="status">
          Noted. Next week’s suggestions follow it.
        </p>
      </li>
    );
  }

  return (
    <li className="card-pad-x row-pad space-y-1">
      {s.url ? (
        <a
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="press-area inline-flex items-start gap-1 text-body font-semibold break-words text-ink underline-offset-2 hover:underline"
        >
          {s.title}
          <ExternalLink className="mt-1.5 size-3 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        </a>
      ) : (
        <p className="text-body font-semibold break-words text-ink">{s.title}</p>
      )}
      {facts && <p className="text-small break-words text-ink-muted">{facts}</p>}
      {s.detail && <p className="max-w-prose text-small break-words text-ink-muted">{s.detail}</p>}
      {s.reaction === 'going' || went.done ? (
        <p className="text-small text-ink-muted">You said you are going. It is on Todo on its day.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {step ? (
            <form action={add}>
              <input type="hidden" name="id" value={s.id} />
              <Button type="submit" size="sm" pending={adding} disabled={busy}>
                Add as step
              </Button>
            </form>
          ) : (
            <form action={goGoing}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="reaction" value="going" />
              <Button type="submit" size="sm" pending={going} disabled={busy}>
                Going
              </Button>
            </form>
          )}
          <form action={decline}>
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="reaction" value="not_for_me" />
            <Button type="submit" size="sm" variant="ghost" pending={declining} disabled={busy}>
              Not for me
            </Button>
          </form>
          {error && (
            <p role="alert" className="w-full text-small text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** "events", "events and reading", "events, reading and courses". */
function kindList(kinds: HelpKindChoice[]): string {
  const names = kinds.map((h) => HELP_KIND_LABELS[h.kind].toLowerCase());
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
