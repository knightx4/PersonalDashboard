'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  seedPlan,
  type PlanActionState,
} from './actions';
import { ActionMenu } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Banner } from '@/components/ui/banner';
import {
  FieldError,
  Input,
} from '@/components/ui/field';
import {
  PLAN_VIEW_CHIPS,
  PLAN_VIEW_LABEL,
  PLAN_VIEW_MENU,
  countMatches,
  flatten,
  searchNodes,
  searchSections,
  searchTerms,
  type PlanLiveness,
  type PlanNode,
  type PlanSection,
  type PlanSummary,
  type PlanView as View,
} from '@/lib/plan/tree';
import {
  withReadings,
  type LastRun,
  type StoredRunReading,
} from '@/lib/plan/run-end';
import { type RunRaise } from '@/lib/plan/work';
import { type CommitCheck } from '@/lib/plan/checks';
import { type PlanCatalogEntry } from './plan-catalog';
import { cn } from '@/lib/cn';
import { PlanRow } from './plan-row';
import { AddStep } from './step-forms';
import { ColumnHeader } from '@/components/plan-tree/grid';
import { Progress, SectionTally } from '@/components/plan-tree/counts';

/**
 * A step as the pickers know it: enough to name it and to place it.
 *
 * And enough to say when it closed, which the account of a run needs: the
 * tree a row is drawn from is narrowed by the view, so the step a run closed
 * is often not in it, while the catalog is every step in the plan.
 */

/** Where a view lives. "Open" is the page itself, so it keeps the bare link. */
function viewHref(view: View): string {
  return view === 'open' ? '/dev/plan' : `/dev/plan?view=${view}`;
}

const chipClass = 'press rounded-full px-2.5 py-1 text-small font-medium transition-colors';
const chipOn = 'bg-accent text-surface';
const chipOff = 'text-ink-muted hover:bg-accent-tint hover:text-accent';

/**
 * What a narrowed view says when it finds nothing.
 *
 * Empty is the good state for most of these, so each one says what it means
 * and what would put something in it -- law 1: an empty section gets a real
 * empty state rather than a blank. `open` and `all` are not here on purpose:
 * an empty plan is a different thing entirely and the page says so elsewhere,
 * and an empty module under Open is the invitation to plan it.
 */
const EMPTY_VIEW: Partial<Record<View, { title: string; description: string }>> = {
  ready: {
    title: 'Nothing ready right now',
    description:
      'Every open step is underway, blocked, or waiting on another. Finish one and the next becomes ready.',
  },
  dismissed: {
    title: 'Nothing put aside',
    description:
      'A question you do not want to settle yet, or a patch of fog you do not want raised, is put aside from the row it sits on. It waits here until you bring it back.',
  },
  blocked: {
    title: 'Nothing waiting right now',
    description: 'Nothing is blocked and nothing waits on another step.',
  },
  proposed: {
    title: 'Nothing proposed right now',
    description:
      'Shape an idea from the ideas page and its proposal will appear here for you to approve.',
  },
  claude: {
    title: "Nothing of Dash's right now",
    description:
      'A step appears here once you approve it and leave it unmarked as yours, with nothing blocking it. You can also send one straight to the routine.',
  },
  you: {
    title: 'Nothing waiting on you',
    description:
      'Every question has been answered, every proposal decided on, and nothing is blocked. The plan can move without you.',
  },
};

/**
 * The numbers across the plan, and the views over it.
 *
 * The counts are links where a view answers them: "3 ready" is the question
 * "which three", and the view is the answer. The views are search parameters
 * rather than state so that "the ready steps" is something you can keep.
 */
function SummaryStrip({
  summary,
  view,
}: {
  summary: PlanSummary;
  view: View;
}) {
  const facts: Array<{ view: View | null; value: number; noun: string }> = [
    { view: 'open', value: summary.open, noun: 'open' },
    // Second, because it is the one number on this line that is a request.
    { view: 'you', value: summary.onYou, noun: 'on you' },
    { view: 'ready', value: summary.ready, noun: 'ready' },
    { view: 'proposed', value: summary.proposed, noun: 'proposed' },
    { view: 'blocked', value: summary.waiting, noun: 'waiting' },
    { view: 'fog', value: summary.fog, noun: 'not specified' },
    // Only once there is something in it. A permanent "0 dismissed" would be
    // a count of a thing that has never happened.
    ...(summary.dismissed > 0
      ? [{ view: 'dismissed' as const, value: summary.dismissed, noun: 'dismissed' }]
      : []),
    { view: null, value: summary.inProgress, noun: 'underway' },
    { view: 'claude', value: summary.claude, noun: "Dash's" },
    { view: null, value: summary.done, noun: 'done' },
  ];

  return (
    <div className={cn(cardVariants({ padding: 'dense' }), 'flex flex-wrap items-center gap-x-4 gap-y-2')}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui text-ink-muted">
        {facts.map((fact) =>
          fact.view ? (
            <Link
              key={fact.noun}
              href={`/dev/plan?view=${fact.view}`}
              className="hover:text-accent hover:underline"
            >
              <span className="tabular font-semibold text-ink">{fact.value}</span> {fact.noun}
            </Link>
          ) : (
            <span key={fact.noun}>
              <span className="tabular font-semibold text-ink">{fact.value}</span> {fact.noun}
            </span>
          ),
        )}
      </p>
      <nav aria-label="View" className="ml-auto flex flex-wrap items-center gap-1">
        {PLAN_VIEW_CHIPS.map((candidate) => (
          <Link
            key={candidate}
            href={viewHref(candidate)}
            aria-current={candidate === view ? 'page' : undefined}
            className={cn(chipClass, candidate === view ? chipOn : chipOff)}
          >
            {PLAN_VIEW_LABEL[candidate]}
          </Link>
        ))}
        {/* The other four. Nothing is lost by moving a view off the row -- it
            is a link in here, and most of them are a link on the counts to the
            left as well -- and the trigger says which one you are on when it is
            one of these, so the row still answers "where am I". */}
        <ActionMenu
          label="More views"
          align="end"
          trigger={
            <span className="inline-flex items-center gap-1">
              {PLAN_VIEW_MENU.includes(view) ? PLAN_VIEW_LABEL[view] : 'More'}
              <ChevronDown className="size-3.5" strokeWidth={2} aria-hidden />
            </span>
          }
          triggerClassName={cn(
            chipClass,
            'gap-1',
            PLAN_VIEW_MENU.includes(view) ? chipOn : chipOff,
          )}
          items={PLAN_VIEW_MENU.map((candidate) => ({
            id: candidate,
            label: PLAN_VIEW_LABEL[candidate],
            href: viewHref(candidate),
            current: candidate === view,
          }))}
        />
      </nav>
    </div>
  );
}

/** The steps in the catalog beneath one, itself included: what it cannot move under or wait on. */


/**
 * The empty state, which is also the import.
 *
 * A button rather than a seed that runs when you first look at the page:
 * writing forty rows because somebody opened a tab is a write nobody got to
 * decline, and saying what it will do first costs one click.
 */
function ImportTheBuildOrder() {
  const [state, action, pending] = useActionState(seedPlan, {} as PlanActionState);

  return (
    <form action={action} className={cn(cardVariants(), 'border-dashed px-4 py-8 text-center')}>
      <p className="text-ui text-ink">Nothing here yet.</p>
      <p className="mx-auto mt-1 max-w-prose text-ui text-ink-muted">
        The build order in <code>docs/BUILD-ORDER.md</code> and the job side&rsquo;s own plan can be
        written in as a starting point — every numbered step, with the ones already marked done
        carried across, each at the top of its module for you to group as you see fit. After that
        this is the plan, and the documents are background reading: nothing here reads them again,
        and the two will drift.
      </p>
      <div className="mt-4 flex flex-col items-center gap-2">
        <Button type="submit" pending={pending}>
          {pending ? 'Importing…' : 'Import the build order'}
        </Button>
        <FieldError>{state.error}</FieldError>
        {state.message && !state.error && (
          <span className="text-small text-ink-muted">{state.message}</span>
        )}
      </div>
    </form>
  );
}

/**
 * Finding a step again.
 *
 * The plan outgrew being read: three hundred steps across nine modules, and
 * the only ways to reach one were to know its module and scroll, or to know
 * which view it happened to fall into. The number, the title and the detail
 * are the three things somebody remembers about a step they are looking for,
 * so all three are searched.
 *
 * It says how many it found rather than leaving you to count the rows, because
 * the count is the answer to "is it in here at all" and the rows are the answer
 * to "which one". Escape clears it, which is what Escape does in a field you
 * are filtering with -- there is a button for the pointer beside it.
 */
function SearchThePlan({
  query,
  onQuery,
  hits,
  searching,
}: {
  query: string;
  onQuery: (next: string) => void;
  hits: number;
  searching: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onQuery('');
          }}
          placeholder="Search the plan — a number, a title, a phrase"
          aria-label="Search the plan"
          className="w-full"
        />
      </div>

      {searching && (
        <p className="tabular text-small text-ink-muted" role="status">
          {hits === 0
            ? 'Nothing matches'
            : `${hits} ${hits === 1 ? 'step' : 'steps'} found`}
          {' · '}
          <button
            type="button"
            onClick={() => onQuery('')}
            className="underline underline-offset-2 hover:text-ink"
          >
            clear
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * The run readings, asked for once the page has drawn.
 *
 * #563: the page appears with whatever was last written down and updates a
 * moment later, rather than holding the render open on a request to GitHub.
 * `app/api/plan/runs` does the asking, writes what came back onto the run rows
 * so the terminal tool and the next session's brief read the same answer, and
 * hands the readings back for the rows already on screen.
 *
 * Nothing is asked when no step is claimed, which is most of the time: there
 * is no run being worked to ask about, and every reading the page has is about
 * a run that is over. Asked once rather than on a timer -- the clock ticks the
 * rows on by itself, and a reading is only worth taking again when something
 * has been sent since.
 *
 * A request that fails changes nothing, so the page goes on showing the
 * reading it drew with. That is the third line of the done-when, and it is
 * what falling back to the clock in `claimLiveness` is for.
 */
function useRefreshedRuns(
  lastRuns: Record<string, LastRun>,
  claims: number,
  stored: string | null,
): { runs: Record<string, LastRun>; refusal: string | null } {
  const [answer, setAnswer] = useState<{
    readings: Record<string, StoredRunReading>;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (claims === 0) return;
    const leaving = new AbortController();

    void (async () => {
      try {
        const res = await fetch('/api/plan/runs', { method: 'POST', signal: leaving.signal });
        if (!res.ok) return;
        const body = (await res.json()) as {
          readings?: Record<string, StoredRunReading>;
          error?: string | null;
        };
        setAnswer({ readings: body.readings ?? {}, error: body.error ?? null });
      } catch {
        // Left as it was drawn.
      }
    })();

    return () => leaving.abort();
  }, [claims]);

  const runs = useMemo(
    () => (answer ? withReadings(lastRuns, answer.readings) : lastRuns),
    [lastRuns, answer],
  );

  // The route's own word wins outright once it has one, `null` included. It
  // asked GitHub a moment ago, and the refusals the page was handed are from
  // whenever anything last asked -- a key replaced between the two would
  // otherwise go on being reported as rejected for as long as one of those
  // runs was on screen. A 200 with no `error` is GitHub answering, which is
  // the fix landing.
  return { runs, refusal: answer ? answer.error : stored };
}

/**
 * What CI said about each closed step's commit, asked for once the page has
 * drawn.
 *
 * The page draws with the answers already stored and this asks
 * `app/api/plan/checks` for anything due to be asked again. That used to happen
 * during the render, which held every open of /dev/plan on GitHub. A request
 * that fails changes nothing; one GitHub refused carries the reason, which the
 * page prints.
 */
function useRefreshedChecks(stored: Record<string, CommitCheck>): {
  checks: Record<string, CommitCheck>;
  error: string | null;
} {
  const [answer, setAnswer] = useState<{
    checks: Record<string, CommitCheck> | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    const leaving = new AbortController();

    void (async () => {
      try {
        const res = await fetch('/api/plan/checks', { method: 'POST', signal: leaving.signal });
        if (!res.ok) return;
        const body = (await res.json()) as {
          checks?: Record<string, CommitCheck> | null;
          error?: string | null;
        };
        setAnswer({ checks: body.checks ?? null, error: body.error ?? null });
      } catch {
        // Left as it was drawn.
      }
    })();

    return () => leaving.abort();
  }, []);

  return { checks: answer?.checks ?? stored, error: answer?.error ?? null };
}

export function PlanView({
  sections,
  finished,
  summary,
  view,
  catalog,
  lastRuns,
  runRaises = [],
  keyRefusal = null,
  liveness,
  commitChecks,
  empty,
  canSend,
  unfolded = false,
  opened = false,
  initialQuery = '',
}: {
  sections: PlanSection[];
  /** The finished features, for the fold at the foot of Everything. */
  finished: PlanNode[];
  summary: PlanSummary;
  view: View;
  catalog: PlanCatalogEntry[];
  /** The newest run against each step, by step id. */
  lastRuns: Record<string, LastRun>;
  /** Every raise that names a step, for the opened step's account of its run. */
  runRaises?: readonly RunRaise[];
  /**
   * Why GitHub is refusing to say what anything has pushed, as the run rows
   * had it when the page rendered.
   *
   * Drawn with rather than waited for, so a rejected key is on screen in the
   * first paint instead of a second later: it is the reason every claimed row
   * below reads off the clock. The route's answer replaces it once that
   * arrives -- see `useRefreshedRuns`.
   */
  keyRefusal?: string | null;
  /** The claims read against their runs, at the clock the page rendered with. */
  liveness?: PlanLiveness;
  /** What CI said about each commit a step shipped in, by the commit's sha. */
  commitChecks: Record<string, CommitCheck>;
  empty: boolean;
  canSend: boolean;
  /**
   * Render every feature with its sub-steps already showing.
   *
   * A seam for the render tests and nothing else -- the page leaves it off, so
   * every feature starts folded there. A folded row renders no children at
   * all, and `renderToStaticMarkup` cannot press the arrow, so the tests that
   * pin how a nested row is laid out would have nothing to look at.
   */
  unfolded?: boolean;
  /**
   * Render every row with its own panel already open.
   *
   * The same kind of seam, for what is behind a row's fold rather than beneath
   * it: the account of a step's run lives there, and nothing can press a title
   * in a static render. The page leaves it off.
   */
  opened?: boolean;
  /** What the search box holds on arrival: `?q=` on the page's address. */
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const searching = searchTerms(query).length > 0;

  // What GitHub says about the runs behind the claimed steps, taken once the
  // page is up and written over the readings it drew with. A claim is the only
  // reason to ask, so the server's own reading of them is what decides whether
  // anything is asked at all.
  const refreshed = useRefreshedRuns(
    lastRuns,
    Object.keys(liveness ?? {}).length,
    keyRefusal,
  );
  const runs = refreshed.runs;
  const ci = useRefreshedChecks(commitChecks);

  // The whole tree is already on the page, so the search runs here rather than
  // as a round trip: a plan is tens of steps, and a filter you feel keeping up
  // with you is a different tool from one you submit. The view stays a search
  // parameter, because "the ready steps" is a thing worth keeping a link to and
  // "the word I typed for ten seconds" is not.
  const shown = useMemo(
    () => (searching ? searchSections(sections, query) : sections),
    [sections, query, searching],
  );
  // The archive searches with everything else. "Did I already plan that" is
  // the question a finished feature gets asked, and it is asked by typing.
  const found = useMemo(
    () => (searching ? searchNodes(finished, query) : finished),
    [finished, query, searching],
  );
  const hits = useMemo(
    () => (searching ? countMatches(shown) + flatten(found).filter((n) => n.matches).length : 0),
    [shown, found, searching],
  );

  if (empty) return <ImportTheBuildOrder />;

  const nothingToShow =
    shown.every((section) => section.nodes.length === 0) && found.length === 0;

  return (
    <div className="space-y-6">
      {/* Above the summary, because it is the reason the summary's claims are
          read off the clock. A banner rather than a status line: the key is a
          setting only the person can change, the sentence GitHub's refusal was
          turned into already says which one and what to do with it, and until
          it is done no row on this page can say whether its session is still
          working. */}
      {refreshed.refusal && (
        <Banner tone="warn">
          <p className="font-semibold">
            Nothing can read what these runs have pushed.
          </p>
          <p>{refreshed.refusal}</p>
          <p className="text-small text-ink-muted">
            Until then a claimed step reads off the clock: claimed for two hours, then stopped.
          </p>
        </Banner>
      )}

      {ci.error && <p className="text-small text-caution">Could not read CI. {ci.error}</p>}

      <SummaryStrip summary={summary} view={view} />

      <SearchThePlan query={query} onQuery={setQuery} hits={hits} searching={searching} />

      {!searching && nothingToShow && EMPTY_VIEW[view] && (
        <EmptyState
          tone="finished"
          title={EMPTY_VIEW[view].title}
          description={EMPTY_VIEW[view].description}
          seed={`plan-${view}`}
        />
      )}

      {/* The sections as a stack of their own. They were spaced like the parts
          of the page -- a summary strip, a filter row, a plan -- which left a
          collapsed module marooned between two large gaps. Between sections
          the right distance is smaller than that, and now that each one is a
          card it is the gap between cards rather than between headings. */}
      <div className="space-y-3">
        {shown.map((section) => {
          // What is finished is consulted, not read -- the same call the rows
          // make about a closed step's children. The progress stays on the
          // summary line either way, so a folded module still says how far it
          // got: law 10, a fold that hides its own count has moved the work.
          const finished = section.progress.live > 0 && section.progress.fraction === 1;

          // Not while searching: a row offering to write a new step under
          // every module is the page's furniture, and a page narrowed to four
          // results should be four results.
          const canAdd = !searching && (view === 'open' || view === 'all');

          return (
            // One card per module, header included, rather than a bar that
            // turns into a heading. The fold used to swap the header's ground,
            // its inset and its height all at once, so a module did not open so
            // much as jump: the line you had just clicked moved out from under
            // the pointer and changed colour doing it. The card is the drawer
            // in both states now, and the only thing the fold animates is the
            // chevron -- which is the whole of what changed.
            <details
              // Keyed on whether a search is running, so starting or clearing
              // one remounts the fold. A module you had collapsed by hand would
              // otherwise stay collapsed over its own results, and the `open`
              // prop below cannot push it back: React writes that attribute on
              // a change of value, not on every render.
              key={`${section.module ?? 'app'}${searching ? ':found' : ''}`}
              // A search opens every module it kept, because it only kept the
              // ones with something in them.
              open={searching || !finished}
              className={cn(cardVariants({ padding: 'none' }), 'group/section overflow-hidden')}
            >
              <summary
                className={cn(
                  'press flex cursor-pointer list-none flex-wrap items-center justify-between gap-2',
                  'px-3 py-2.5 [&::-webkit-details-marker]:hidden',
                  'transition-colors duration-150 hover:bg-sunken',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2',
                  // The hairline belongs to the fold, not to the list: it is
                  // what joins the header to what it opened, and a border round
                  // the list as well would be a border inside a border (law 11).
                  'group-open/section:border-b group-open/section:border-border',
                )}
              >
                <h2 className="flex items-center gap-2 text-body font-semibold text-ink">
                  <ChevronRight
                    aria-hidden
                    strokeWidth={2}
                    className="size-4 shrink-0 text-ink-muted transition-transform duration-150 group-open/section:rotate-90"
                  />
                  {section.label}
                </h2>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <SectionTally tally={section.tally} label={section.label} />
                  <Progress
                    label={section.label}
                    progress={section.progress}
                    bands={section.bands}
                  />
                </span>
              </summary>

              {section.nodes.length > 0 && (
                <ul className="divide-y divide-border">
                  <ColumnHeader />
                  {section.nodes.map((node) => (
                    <PlanRow
                      key={node.id}
                      node={node}
                      trail={[]}
                      catalog={catalog}
                      canSend={canSend}
                      lastRuns={runs}
                      runRaises={runRaises}
                      liveness={liveness}
                      commitChecks={ci.checks}
                      view={view}
                      searching={searching}
                      unfolded={unfolded}
                      opened={opened}
                    />
                  ))}
                </ul>
              )}

              {/* Unfolded onto nothing was the worst of it: a dashed box the
                  width of the page saying "No plan for Shopping yet", with a
                  second box under it to add one. A module with nothing in it
                  has nothing to show -- law 1 -- and the offer to write the
                  first step is the one line worth putting there. The finished
                  case does say something, because "nothing here" and "all of it
                  shipped" are different facts and only one of them is empty. */}
              {section.nodes.length === 0 && finished && (
                <p className="px-3 py-2.5 text-ui text-ink-muted">
                  Everything planned for {section.label} is done.
                </p>
              )}

              {canAdd && (
                <div
                  className={cn(
                    'px-3 py-2',
                    section.nodes.length > 0 && 'border-t border-border',
                  )}
                >
                  <AddStep module={section.module} parentId={null} />
                </div>
              )}
            </details>
          );
        })}
      </div>

      {/* What is finished, out of the way but not gone. Folded shut, newest
          first, and only on Everything -- every other view dropped these rows
          before the page saw them. A search opens it, because "did I already
          plan that" is the question it exists to answer. */}
      {found.length > 0 && (
        <details
          key={searching ? 'finished:found' : 'finished'}
          open={searching}
          className={cn(cardVariants({ padding: 'none' }), 'group/section overflow-hidden')}
        >
          <summary
            className={cn(
              'press flex cursor-pointer list-none flex-wrap items-center justify-between gap-2',
              'px-3 py-2.5 [&::-webkit-details-marker]:hidden',
              'transition-colors duration-150 hover:bg-sunken',
              'focus-visible:outline-2 focus-visible:-outline-offset-2',
              'group-open/section:border-b group-open/section:border-border',
            )}
          >
            <h2 className="flex items-center gap-2 text-body font-semibold text-ink">
              <ChevronRight
                aria-hidden
                strokeWidth={2}
                className="size-4 shrink-0 text-ink-muted transition-transform duration-150 group-open/section:rotate-90"
              />
              Finished
            </h2>
            <span className="text-ui text-ink-muted">
              <span className="tabular font-semibold text-ink">{found.length}</span>{' '}
              {found.length === 1 ? 'feature' : 'features'}
            </span>
          </summary>
          <ul className="divide-y divide-border">
            <ColumnHeader />
            {found.map((node) => (
              <PlanRow
                key={node.id}
                node={node}
                trail={[]}
                catalog={catalog}
                canSend={canSend}
                lastRuns={runs}
                runRaises={runRaises}
                liveness={liveness}
                commitChecks={ci.checks}
                view={view}
                searching={searching}
                unfolded={unfolded}
                opened={opened}
              />
            ))}
          </ul>
        </details>
      )}

      {/* The app-wide list is not offered as a section until something is in
          it, so this is the only way to put the first thing there. Only on
          Everything, which is where the empty sections live now: drawing this
          heading over the open view would put back the one thing dropping
          them took away. */}
      {!searching &&
        view === 'all' &&
        !sections.some((section) => section.module === null) && (
          <section className="space-y-2">
            <h2 className="text-body font-semibold text-ink">The app as a whole</h2>
            <AddStep module={null} parentId={null} />
          </section>
        )}
    </div>
  );
}

export type { PlanCatalogEntry };
