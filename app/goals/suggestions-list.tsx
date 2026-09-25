'use client';

import { useActionState } from 'react';
import { CalendarDays, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HELP_KIND_LABELS } from '@/lib/goals/help-kinds';
import { REACTION_LABELS, type Suggestion } from '@/lib/goals/suggestions';
import { reactToSuggestionAction, type SuggestionActionState } from './suggestion-actions';

/**
 * This week's suggestions from the weekly run, on the Goals home (plan #934).
 *
 * Each has going and not for me. Going puts it on Todo on its date; not for
 * me takes it off this list. Either can be pressed again to change your mind,
 * and both are what next week's research reads.
 */

const initial: SuggestionActionState = {};

function whenLine(s: Suggestion): string | null {
  if (s.startsAt) {
    return new Date(s.startsAt).toLocaleString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  if (s.happensOn) {
    return new Date(`${s.happensOn}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }
  return null;
}

export function SuggestionsList({ suggestions }: { suggestions: Suggestion[] }) {
  return (
    <section aria-labelledby="suggestions-heading" className="space-y-2">
      <h2 id="suggestions-heading" className="px-1 text-ui font-semibold text-ink">
        Suggested this week
      </h2>
      <Card>
        <ul className="divide-y divide-border">
          {suggestions.map((s) => (
            <SuggestionRow key={s.id} suggestion={s} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

function SuggestionRow({ suggestion: s }: { suggestion: Suggestion }) {
  const [state, react, pending] = useActionState(reactToSuggestionAction, initial);
  const meta = [HELP_KIND_LABELS[s.kind], whenLine(s), s.place, s.source].filter(Boolean).join(' · ');
  const going = s.reaction === 'going';

  return (
    <li className="card-pad-x row-pad flex items-start gap-2">
      <CalendarDays className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {s.url ? (
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-start gap-1 text-ui break-words text-ink underline-offset-2 hover:underline"
          >
            {s.title}
            <ExternalLink className="mt-1 size-3 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
          </a>
        ) : (
          <span className="block text-ui break-words text-ink">{s.title}</span>
        )}
        {meta && <span className="block text-small break-words text-ink-muted">{meta}</span>}
        {s.detail && <p className="text-small break-words text-ink-muted">{s.detail}</p>}
        <form action={react} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={s.id} />
          {going ? (
            <span className="text-small text-ink">{REACTION_LABELS.going} · on Todo</span>
          ) : (
            <Button type="submit" name="reaction" value="going" size="sm" variant="secondary" pending={pending}>
              Going
            </Button>
          )}
          <Button type="submit" name="reaction" value="not_for_me" size="sm" variant="ghost" pending={pending}>
            Not for me
          </Button>
          {state.error && <span className="text-small text-danger">{state.error}</span>}
        </form>
      </div>
    </li>
  );
}
