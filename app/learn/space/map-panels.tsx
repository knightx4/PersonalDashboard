'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import Link from '@/components/ui/link';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { ChipInput } from '@/components/ui/field';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { whenDate } from '@/lib/core/when';
import { practiceHref } from '@/lib/learn/flow/href';
import type { IdeaMapView } from '@/lib/learn/map/load';
import {
  chosenPerformance,
  dayBefore,
  fadingIdeas,
  FADE_SOON_DAYS,
  parseDay,
  performances,
  readingsOn,
  THEN_DAYS_BACK,
  thenAndNow,
  type FadingIdea,
  type GoalLevels,
  type Panel,
  type Performance,
  type Rung,
} from '@/lib/learn/map/panels';
import { countText, mapHref, type MapParams } from '@/lib/learn/map/view';
import { viewOnClick } from './pick';

/**
 * The three panels under Idea Space's map (plan #2187.6), as tabbed
 * sections: what will fade soonest with a re-check for each, the open rungs
 * under one target of the chosen goal you cannot do yet, and the chosen goal
 * on two days side by side.
 *
 * The open tab and the earlier day are in the address (`panel`, `then`), set
 * through the page's view state so a press answers at once and a reload or
 * a pasted link returns to it. Only the open tab is drawn. Worked out in the
 * browser from what the page already holds (lib/learn/map/panels.ts).
 */

const SHOWN = 5;
const TOPIC_HREF = (id: string) => `/learn/topics/${id}`;
const STATUS_TEXT = {
  tested: 'tested',
  declared: 'said you know it',
  inferred: 'inferred',
} as const;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${countText(n)} ${n === 1 ? one : many}`;
}

function day(at: string | Date, asOf: Date): string {
  return whenDate(at, { timeZone: 'UTC', year: 'auto', now: asOf });
}

export function MapPanels({
  view,
  params,
  set,
  pickOpen = false,
}: {
  view: IdeaMapView;
  params: MapParams;
  set: (change: Partial<MapParams>) => void;
  /** The gallery draws the then tab's day picker open. */
  pickOpen?: boolean;
}) {
  const levels = view.levels;
  const asOf = useMemo(() => new Date(view.asOf), [view.asOf]);
  const territory = params.goal ? view.territories?.find((t) => t.id === params.goal) : undefined;
  const goal = params.goal ? view.goals?.find((g) => g.id === params.goal) : undefined;
  const lens = params.goal ? levels?.lenses.find((l) => l.id === params.goal) : undefined;
  const goalName = goal?.name ?? territory?.name ?? lens?.name ?? null;
  const navRef = useRef<HTMLElement>(null);

  // At phone width the row scrolls; bring the open tab into view along it,
  // as the shared row of tabs does, so the page itself does not move.
  useEffect(() => {
    const nav = navRef.current;
    const open = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !open) return;
    const row = nav.getBoundingClientRect();
    const box = open.getBoundingClientRect();
    if (box.left < row.left || box.right > row.right - 16)
      nav.scrollLeft += box.right - row.right + 24;
  }, [params.panel]);

  const ideasOfGoal = useMemo(
    () => (territory ? new Set(territory.topics.map((topic) => topic.id)) : null),
    [territory],
  );
  const fading = useMemo(
    () => fadingIdeas(view.ideas, asOf, ideasOfGoal),
    [view.ideas, asOf, ideasOfGoal],
  );
  const now = useMemo(() => (levels ? readingsOn(levels.map, asOf) : null), [levels, asOf]);
  const gaps = useMemo(
    () => (levels && now && params.goal ? performances(levels, now, params.goal) : []),
    [levels, now, params.goal],
  );
  const performance = chosenPerformance(gaps, params.topic);

  if (levels === undefined) return null;

  const soon = fading.filter((idea) => idea.inDays < FADE_SOON_DAYS).length;
  const tabs: { id: Panel; label: string; count?: number }[] = [
    { id: 'fade', label: 'Fading soonest', count: soon },
    { id: 'gaps', label: 'Gaps to a target', count: performance?.rungs.length },
    { id: 'then', label: 'Then and now' },
  ];

  return (
    <section aria-label="Under the map" className="mt-6">
      <nav
        ref={navRef}
        aria-label="Under the map"
        className={cn(
          'mb-4 flex gap-1 overflow-x-auto border-b border-border',
          'max-sm:-mr-4 max-sm:pr-4 sm:max-lg:-mr-6 sm:max-lg:pr-6 max-lg:[mask-image:linear-gradient(to_right,#000_calc(100%-1rem),transparent)]',
        )}
      >
        {tabs.map((tab) => {
          const on = params.panel === tab.id;
          return (
            <Link
              key={tab.id}
              href={mapHref(params, { panel: tab.id })}
              scroll={false}
              onClick={viewOnClick(() => set({ panel: tab.id }))}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'press-area -mb-px flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-ui font-medium transition-colors duration-quick',
                on
                  ? 'border-accent text-accent'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="tabular font-normal text-ink-muted">{tab.count}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {params.panel === 'fade' && (
        <FadePanel fading={fading} asOf={asOf} goalName={territory ? goalName : null} />
      )}
      {params.panel === 'gaps' &&
        (levels === null ? (
          <Unread />
        ) : (
          <GapsPanel
            goalName={goalName}
            goals={levels.lenses}
            performance={performance}
            others={gaps.filter((p) => p !== performance)}
            params={params}
            set={set}
          />
        ))}
      {params.panel === 'then' &&
        (levels === null ? (
          <Unread />
        ) : (
          <ThenPanel
            levels={levels}
            goalId={params.goal}
            goalName={goalName}
            asOf={asOf}
            params={params}
            set={set}
            pickOpen={pickOpen}
          />
        ))}
    </section>
  );
}

function Unread() {
  return (
    <p className="text-ui text-ink-muted">
      Your subjects&rsquo; levels could not be read just now. Reload to try again.
    </p>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <Card padding="standard">
      <div className="max-w-prose text-ui text-ink-muted">{children}</div>
    </Card>
  );
}

/** With no goal chosen: the goals to choose from, in the panel itself, so a phone without the rail beside it can choose. */
function ChooseGoal({
  lead,
  goals,
  params,
  set,
}: {
  lead: string;
  goals: readonly { id: string; name: string }[];
  params: MapParams;
  set: (change: Partial<MapParams>) => void;
}) {
  if (goals.length === 0) {
    return <Quiet>Prepare a subject in Learn to {lead}</Quiet>;
  }
  return (
    <Quiet>
      <p>Choose a subject to {lead}</p>
      <ul className="mt-1 divide-y divide-border">
        {goals.map((goal) => (
          <li key={goal.id}>
            <Link
              href={mapHref(params, { goal: goal.id, topic: null })}
              scroll={false}
              onClick={viewOnClick(() => set({ goal: goal.id, topic: null }))}
              className="press-area block py-2 text-ui text-ink hover:text-accent"
            >
              {goal.name}
            </Link>
          </li>
        ))}
      </ul>
    </Quiet>
  );
}

function Folded<T>({
  rows,
  render,
  more,
}: {
  rows: readonly T[];
  render: (row: T) => React.ReactNode;
  more: string;
}) {
  const shown = rows.slice(0, SHOWN);
  const rest = rows.slice(SHOWN);
  return (
    <>
      <ul className="divide-y divide-border">{shown.map(render)}</ul>
      {rest.length > 0 && (
        <Disclosure
          title={`${countText(rest.length)} ${more}`}
          className="mt-1"
          bodyClassName="pl-0"
        >
          <ul className="divide-y divide-border">{rest.map(render)}</ul>
        </Disclosure>
      )}
    </>
  );
}

// -- Fading soonest -------------------------------------------------------------

function FadePanel({
  fading,
  asOf,
  goalName,
}: {
  fading: FadingIdea[];
  asOf: Date;
  goalName: string | null;
}) {
  if (fading.length === 0) {
    return (
      <Quiet>
        {goalName
          ? `Nothing in ${goalName} is held yet, so nothing in it fades. A topic starts to fade once a question, or your own word, sets what you know of it.`
          : 'Nothing you hold is fading yet. A topic starts to fade once a question, or your own word, sets what you know of it.'}
      </Quiet>
    );
  }
  return (
    <Card padding="standard">
      <div className="-mt-2">
        <Folded
          rows={fading}
          more="more"
          render={(idea) => (
            <li key={idea.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <Link
                  href={TOPIC_HREF(idea.id)}
                  className="press-area block text-ui text-ink hover:text-accent"
                >
                  {idea.name}
                </Link>
                <span className="tabular block truncate text-small text-ink-muted">
                  Halves {day(idea.halvesOn, asOf)} · {STATUS_TEXT[idea.established]}{' '}
                  {day(idea.setAt, asOf)}
                </span>
              </span>
              <Link
                href={practiceHref({ track: idea.trackId })}
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0')}
                aria-label={`Re-check ${idea.name}`}
              >
                Re-check
              </Link>
            </li>
          )}
        />
      </div>
      <p className="mt-2 text-small text-ink-muted">
        {goalName
          ? `The topics of ${goalName}, soonest first.`
          : 'Every topic you hold, soonest first.'}{' '}
        A re-check sets one back to full.
      </p>
    </Card>
  );
}

// -- Gaps to a target -----------------------------------------------------------

function GapsPanel({
  goalName,
  goals,
  performance,
  others,
  params,
  set,
}: {
  goalName: string | null;
  goals: readonly { id: string; name: string }[];
  performance: Performance | null;
  others: Performance[];
  params: MapParams;
  set: (change: Partial<MapParams>) => void;
}) {
  if (!goalName) {
    return (
      <ChooseGoal
        lead="see the levels that stand between you and one of its targets."
        goals={goals}
        params={params}
        set={set}
      />
    );
  }
  if (!performance) {
    return <Quiet>Every target of {goalName} is held, so nothing stands open under it.</Quiet>;
  }
  const ready = performance.rungs.filter((rung) => rung.ready).length;
  return (
    <Card padding="standard">
      <h3 className="text-body font-medium text-ink">
        {performance.name} at level {performance.level}
      </h3>
      <p className="mt-0.5 text-ui text-ink-muted">
        You hold level {performance.held}, and{' '}
        {plural(performance.rungs.length, 'level')} up to it{' '}
        {performance.rungs.length === 1 ? 'is' : 'are'} still open
        {ready > 0 ? `, ${countText(ready)} of them ready now.` : '.'}
      </p>
      {!performance.approved && (
        <p className="mt-1 text-ui text-ink-muted">
          This topic is still a draft, so nothing is asked about it until it is approved on its
          page.
        </p>
      )}
      <RungGroups rungs={performance.rungs} />

      {others.length > 0 && (
        <Disclosure
          title="Its other targets"
          meta={countText(others.length)}
          className="mt-2"
          bodyClassName="pl-0"
        >
          <ul className="divide-y divide-border">
            {others.map((other) => (
              <li key={other.topicId}>
                <Link
                  href={mapHref(params, { topic: other.topicId })}
                  scroll={false}
                  onClick={viewOnClick(() => set({ topic: other.topicId }))}
                  className="press-area flex items-baseline justify-between gap-3 py-2 text-ui text-ink hover:text-accent"
                >
                  <span className="min-w-0">
                    {other.name} at level {other.level}
                  </span>
                  <span className="tabular shrink-0 text-small text-ink-muted">
                    {countText(other.rungs.length)} open
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </Card>
  );
}

/**
 * The open rungs by topic, the performance's own first: the topic named once
 * over its levels, each level leading with what it asks. Past the first
 * topic, the rest fold away once there are more than SHOWN rows.
 */
function RungGroups({ rungs }: { rungs: readonly Rung[] }) {
  const groups: { topicId: string; name: string; rungs: Rung[] }[] = [];
  for (const rung of rungs) {
    const last = groups.at(-1);
    if (last && last.topicId === rung.topicId) last.rungs.push(rung);
    else groups.push({ topicId: rung.topicId, name: rung.topicName, rungs: [rung] });
  }
  const [first, ...rest] = groups;
  if (!first) return null;
  const restRows = rest.reduce((n, g) => n + g.rungs.length, 0);
  const fold = first.rungs.length + restRows > SHOWN;
  return (
    <div className="mt-2 space-y-3">
      <RungGroup group={first} />
      {rest.length > 0 &&
        (fold ? (
          <Disclosure
            title={`${plural(restRows, 'more level')} on ${plural(rest.length, 'topic')} it needs`}
            bodyClassName="pl-0 space-y-3"
          >
            {rest.map((group) => (
              <RungGroup key={group.topicId} group={group} />
            ))}
          </Disclosure>
        ) : (
          rest.map((group) => <RungGroup key={group.topicId} group={group} />)
        ))}
    </div>
  );
}

function RungGroup({ group }: { group: { name: string; rungs: Rung[] } }) {
  return (
    <div>
      <h4 className="text-small font-medium text-ink-muted">{group.name}</h4>
      <ul className="divide-y divide-border">
        {group.rungs.map((rung) => (
          <li key={rung.cellId} className="flex items-start gap-3 py-2">
            <span className="tabular w-14 shrink-0 text-ui text-ink-muted">Level {rung.level}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-ui text-ink">{capitalise(rung.can)}</span>
              {rung.status === 'missed' && (
                <span className="block text-small text-danger">Missed last time</span>
              )}
            </span>
            {rung.ready && (
              <Link
                href={practiceHref({ cell: rung.cellId })}
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0')}
                aria-label={`Practise ${rung.topicName} at level ${rung.level}`}
              >
                Practise
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// -- Then and now ---------------------------------------------------------------

const QUICK_DAYS = [
  { label: 'A week ago', days: 7 },
  { label: 'Four weeks ago', days: THEN_DAYS_BACK },
  { label: 'Three months ago', days: 91 },
] as const;

function ThenPanel({
  levels,
  goalId,
  goalName,
  asOf,
  params,
  set,
  pickOpen,
}: {
  levels: GoalLevels;
  goalId: string | null;
  goalName: string | null;
  asOf: Date;
  params: MapParams;
  set: (change: Partial<MapParams>) => void;
  pickOpen: boolean;
}) {
  const [picking, setPicking] = useState(pickOpen);
  const thenDay = params.then ?? dayBefore(asOf, THEN_DAYS_BACK);
  const then = parseDay(thenDay)!;
  const view = useMemo(
    () => (goalId ? thenAndNow(levels, goalId, then, asOf) : null),
    // `then` is read from `thenDay`, which is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [levels, goalId, thenDay, asOf],
  );
  if (!goalName || !view) {
    return (
      <ChooseGoal
        lead="see where you stood on it then and where you stand now."
        goals={levels.lenses}
        params={params}
        set={set}
      />
    );
  }
  const choose = (next: string) => {
    set({ then: next === dayBefore(asOf, THEN_DAYS_BACK) ? null : next });
  };
  const moved = view.rows.filter((row) => row.now !== row.then).length;
  const anyHeld = view.rows.some((row) => row.then > 0 || row.now > 0);

  return (
    <Card padding="standard">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-medium text-ink">{goalName}</h3>
        <button
          type="button"
          onClick={() => setPicking((open) => !open)}
          aria-expanded={picking}
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'ml-auto shrink-0')}
        >
          <CalendarDays strokeWidth={1.75} aria-hidden />
          Then: {day(then, asOf)}
        </button>
      </div>
      {picking && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span role="group" aria-label="Then" className={segmentedFrame}>
            {QUICK_DAYS.map((quick) => {
              const value = dayBefore(asOf, quick.days);
              return (
                <button
                  key={quick.days}
                  type="button"
                  aria-pressed={thenDay === value}
                  onClick={() => choose(value)}
                  className={cn(segmentClass(thenDay === value), 'shrink-0 whitespace-nowrap')}
                >
                  {quick.label}
                </button>
              );
            })}
          </span>
          <ChipInput
            type="date"
            aria-label="Another day"
            // A full press target on a phone (44px), as every other control here.
            style={{ minHeight: '2.75rem' }}
            icon={<CalendarDays className="size-4" strokeWidth={1.75} />}
            value={thenDay}
            max={dayBefore(asOf, 1)}
            onChange={(event) => {
              if (parseDay(event.target.value)) choose(event.target.value);
            }}
          />
        </div>
      )}

      {anyHeld && (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-small text-ink-muted">{day(then, asOf)}</dt>
            <dd className="tabular text-body text-ink">
              {countText(view.heldThen)} of {plural(view.total, 'level')} held
            </dd>
          </div>
          <div>
            <dt className="text-small text-ink-muted">Today</dt>
            <dd className="tabular text-body text-ink">
              {countText(view.heldNow)} of {plural(view.total, 'level')} held
            </dd>
          </div>
        </dl>
      )}

      {!anyHeld ? (
        <p className="mt-3 max-w-prose text-ui text-ink-muted">
          Nothing was held on either day:{' '}
          {view.rows.length === 1
            ? 'the one topic with a target is'
            : `the ${countText(view.rows.length)} topics with a target are all`}{' '}
          still at level 0.
          {view.rows.every((row) => !row.approved) &&
            ' They are drafts, so nothing is asked about them until they are approved.'}
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-ui text-ink-muted">
            {moved === 0
              ? 'No topic has moved since then.'
              : `${plural(moved, 'topic')} moved since then, the most first.`}
          </p>
          <div
            className="mt-1 grid grid-cols-[1fr_auto_auto] gap-x-4 text-small text-ink-muted"
            aria-hidden
          >
            <span />
            <span className="w-14 text-right">{day(then, asOf)}</span>
            <span className="w-14 text-right">Today</span>
          </div>
          <Folded
            rows={view.rows}
            more="more topics"
            render={(row) => (
              <li
                key={row.topicId}
                className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 py-2 text-ui"
              >
                <span className="min-w-0 text-ink">{row.name}</span>
                <span
                  className="tabular w-14 text-right text-ink-muted"
                  aria-label={`Level ${row.then} then`}
                >
                  {row.then}
                </span>
                <span
                  className={cn(
                    'tabular w-14 text-right',
                    row.now > row.then ? 'font-medium text-ink' : 'text-ink-muted',
                  )}
                  aria-label={`level ${row.now} today, of ${row.target}`}
                >
                  {row.now}
                  <span className="text-ink-ghost">/{row.target}</span>
                </span>
              </li>
            )}
          />
        </div>
      )}
    </Card>
  );
}
