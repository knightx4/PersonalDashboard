'use client';

import { useState } from 'react';
import { InboxPage, type InboxLaterRow, type InboxRow } from '@/components/inbox/inbox-page';
import type { GoalInboxGroup } from '@/lib/goals/inbox';
import type { LaterLaneItem } from '@/lib/goals/lanes';
import type { TodayItem } from '@/lib/goals/today';
import { formatDay } from '@/lib/goals/dates';
import { stepHref } from '@/lib/goals/all-goals';
import { RunQuestionCard } from '@/components/runs/run-question-card';
import { answerGoalRunAction } from '../runs/[runId]/actions';
import { DashRow } from '../goal-lanes';
import { bringBackAction } from '../home-actions';
import { TodayRow } from '../today-list';
import { BundleRow } from './bundle-row';
import { FinishedRow } from './finished-row';

const keyOf = (item: TodayItem) => `${item.kind}:${item.id}`;

/**
 * Everything on you in Goals, on a tab of its own, drawn by the one Inbox
 * component every workspace uses (components/inbox/inbox-page.tsx): the
 * overview of counts, then one section per kind of work, then what was put
 * off, shut under Later.
 *
 * The rows are the Home's own (TodayRow, DashRow), so a button here does what
 * it does under Do next, and Later on a row is the Inbox's put-off. Rows that
 * repeat one thing (a goal's questions, the goals offered for parking) come
 * folded into one BundleRow each, and a step Dash finished that you asked
 * about is a FinishedRow (plan #2611.2). Moves
 * show at once: a row put off or handed to Dash leaves the list, and the
 * server's redraw then puts each where it is.
 */
export function GoalsInboxView({
  groups,
  laterOn,
  preparable,
  canRun,
  preview,
}: {
  groups: readonly GoalInboxGroup[];
  laterOn: readonly LaterLaneItem[];
  preparable: readonly string[];
  /** Whether this account can start a run, which Ask Dash on a row needs. */
  canRun: boolean;
  /** For the gallery: the finished step whose Done is drawn showing, as hover shows it. */
  preview?: { revealNoticeId?: string };
}) {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const hide = (key: string, hidden: boolean) =>
    setGone((current) => {
      const next = new Set(current);
      if (hidden) next.add(key);
      else next.delete(key);
      return next;
    });
  const canPrepare = new Set(canRun ? preparable : []);

  const rows: InboxRow[] = groups.flatMap((group) => [
    // First: a run is held until it hears back, where a step of yours waits
    // as long as you like.
    ...group.runs.map((question) => ({
      ref: `run:${question.runId}`,
      section: group.key,
      title: question.about,
      move: { state: 'on_you' as const },
      card: <RunQuestionCard question={question} action={answerGoalRunAction} />,
    })),
    // Then the rows that say one thing many times, folded into one each.
    ...group.bundles
      .filter((bundle) => !gone.has(bundle.key))
      .map((bundle) => ({
        ref: bundle.key,
        section: group.key,
        title: bundle.title,
        move: { state: 'on_you' as const },
        card: <BundleRow bundle={bundle} onGone={(hidden) => hide(bundle.key, hidden)} />,
      })),
    ...group.items
      .filter((item) => !gone.has(keyOf(item)))
      .map((item) => ({
        ref: keyOf(item),
        section: group.key,
        title: item.title,
        move: { state: 'on_you' as const },
        card:
          item.kind === 'finished' ? (
            <FinishedRow
              item={item}
              onGone={(hidden) => hide(keyOf(item), hidden)}
              revealed={preview?.revealNoticeId === item.id}
            />
          ) : (
            <TodayRow
              item={item}
              rank={null}
              preparable={canPrepare.has(item.id)}
              onAside={(hidden) => hide(keyOf(item), hidden)}
              onHanded={() => hide(keyOf(item), true)}
              onSnoozed={(hidden) => hide(keyOf(item), hidden)}
            />
          ),
      })),
    ...group.dash.map((item) => ({
      ref: `dash:${item.id}`,
      section: group.key,
      title: item.title,
      move: { state: 'on_you' as const },
      card: <DashRow item={item} />,
    })),
  ]);

  // Steps whose start day is later: off you until then.
  const later: InboxLaterRow[] = laterOn.map((item) => ({
    ref: `later:${item.id}`,
    title: item.title,
    href: stepHref(item.goalId, item.id),
    line: `${item.goalTitle} · back ${formatDay(item.startsOn)}${item.dueOn ? `, due ${formatDay(item.dueOn)}` : ''}`,
    bringBack: { action: bringBackAction, fields: { id: item.id } },
  }));

  return (
    <InboxPage
      rows={rows}
      later={later}
      empty={{
        title: 'Nothing waiting on you',
        description:
          'A step of yours, a question Dash asked, a flag or a proposal lands here until it is done or answered, and so does a step Dash finished that you asked to hear about, until you open it.',
        align: 'start',
      }}
    />
  );
}
