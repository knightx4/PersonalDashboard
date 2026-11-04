'use client';

import { useId, useState, useTransition } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { CardSection } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import type { BriefGoalPanel } from '@/lib/learn/briefs/topics';
import { draftBriefTopics } from './actions';

/**
 * The brief's place on your map (plan #2184.1), in the brief page's rail:
 * choose the learning goal the question belongs to, each goal named in full,
 * and Draft its topic, and
 * the topic compiler drafts it from the pages the brief quoted. The draft
 * opens on its own page; approving it there adds it to the goal and writes
 * the next cards on that goal from these answers.
 *
 * Once a topic is drafted, the section lists the topics drafted from the
 * brief instead, each with whether it is approved. With no learning goal
 * set, it says where to name one.
 *
 * `shown` is for the gallery, which draws the press mid-draft or failed.
 */
export function GoalPanel({
  briefId,
  panel,
  shown,
}: {
  briefId: string;
  panel: BriefGoalPanel;
  shown?: { pending?: boolean; error?: string };
}) {
  const [aimId, setAimId] = useState(panel.aim?.id ?? panel.goals[0]?.id ?? '');
  const [error, setError] = useState<string | null>(shown?.error ?? null);
  const [sending, start] = useTransition();
  const pending = sending || shown?.pending === true;
  const groupName = useId();
  const chosen = panel.goals.find((goal) => goal.id === aimId);

  if (panel.topics.length > 0) {
    const under = panel.aim?.name ?? panel.topics[0]?.aimName ?? '';
    return (
      <CardSection title="On your map">
        {under && <p className="text-small text-ink-muted">Under your goal: {under}</p>}
        <ul className="mt-1 flex flex-col">
          {panel.topics.map((topic) => (
            <li key={topic.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
              <Link
                href={`/learn/topics/${topic.id}`}
                className={linkVariants({ className: 'inline-flex min-h-11 items-center text-ui [overflow-wrap:anywhere] lg:min-h-8' })}
              >
                {topic.name}
              </Link>
              <span className="text-small text-ink-muted">{topic.approved ? 'Approved' : 'Draft'}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-small text-ink-muted">
          {panel.topics.some((topic) => topic.approved)
            ? 'The next cards on this goal come from these answers.'
            : 'Approve a draft to add it to the goal. The topics it links to are drafted from its page.'}
        </p>
      </CardSection>
    );
  }

  if (panel.goals.length === 0) {
    return (
      <CardSection title="On your map">
        <p className="text-ui text-ink-muted">
          Name a learning goal to put this research on your map.
        </p>
        <Link href="/learn/know" className={linkVariants({ className: 'inline-flex min-h-11 items-center text-ui lg:min-h-8' })}>
          Name a goal on Know
        </Link>
      </CardSection>
    );
  }

  return (
    <CardSection title="On your map">
      <div className="flex flex-col gap-3">
        {pending ? (
          <p className="text-ui text-ink [overflow-wrap:anywhere]">
            <span className="block text-small text-ink-muted">For your goal</span>
            {chosen?.name}
          </p>
        ) : (
          <fieldset className="flex flex-col">
            <legend className="text-small text-ink-muted">The goal it is for</legend>
            {panel.goals.map((goal) => (
              <label
                key={goal.id}
                className="flex min-h-11 cursor-pointer items-start gap-2 py-1.5 text-ui text-ink lg:min-h-8"
              >
                <input
                  type="radio"
                  name={groupName}
                  value={goal.id}
                  checked={aimId === goal.id}
                  onChange={() => setAimId(goal.id)}
                  className="mt-1 size-4 shrink-0 accent-accent"
                />
                <span className="[overflow-wrap:anywhere]">{goal.name}</span>
              </label>
            ))}
          </fieldset>
        )}
        <p className="text-small text-ink-muted">
          Dash drafts the topic from the pages this research quoted, in a few minutes, and adds it to the goal. Its
          next cards come from these answers.
        </p>
        <DashAction
          type="button"
          size="sm"
          variant={pending ? 'ghost' : 'secondary'}
          pending={pending}
          paid={pending ? undefined : 'app/learn/b/[id]/actions.ts#draftBriefTopics'}
          what="Cost of drafting the topic"
          hintFirst
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await draftBriefTopics(briefId, aimId);
              if (result?.error) setError(result.error);
            })
          }
        >
          {pending ? 'Sending it to Dash…' : 'Draft its topic'}
        </DashAction>
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
      </div>
    </CardSection>
  );
}
