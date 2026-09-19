import { MODULES, type ModuleId } from '@/lib/modules';
import {
  DEFAULT_BLOCK_KIND,
  hasLiveFog,
  isClosed,
  isDismissed,
  type PlanAssignee,
  type PlanBlockKind,
  type PlanData,
  type PlanItem,
  type PlanStatus,
} from './load';
import { claimLiveness, type ClaimLiveness, type ClaimRun, type ClaimStep } from './liveness';

/**
 * The plan, read.
 *
 * Rows come out of the database flat; this turns them into the thing the page
 * shows and the CLI works from — steps nested under steps, each one knowing
 * what it waits on, how far through its own steps it is, and whether it could
 * be picked up right now. Pure, so a page and a script agree on every one of
 * those answers, and so each rule below can be pinned by a test.
 */

export type PlanProgress = {
  done: number;
  inProgress: number;
  blocked: number;
  /** Steps that count toward the total: everything not dropped. */
  live: number;
  /** 0 to 1 over the live steps, or null when there are none to be through. */
  fraction: number | null;
};

/** Enough of another step to name it: in a chip, a picker, a brief. */
export type PlanRef = {
  id: string;
  number: number;
  title: string;
  status: PlanStatus;
  module: ModuleId | null;
};

/** One "cannot start until" edge, with the row it is stored as. */
export type PlanLink = {
  dependencyId: string;
  item: PlanRef;
};

export type PlanNode = PlanItem & {
  /** 0 at the top of a module's plan. */
  depth: number;
  /**
   * Where the row sits in its feature, to read: "595" on a feature and
   * "595.2" on the second step under it.
   *
   * Not the identity -- `number` is, and stays. Every commit subject on main
   * says "plan #601", 330 rows and 25 comments carry a `#nnn` in their text,
   * and a commit message cannot be rewritten, so a step's number can never be
   * given away to a different row. What the outline is for is reading: #597
   * says nothing about which feature it belongs to or how far through it is,
   * and 595.2 says both.
   *
   * Worked out here, before any view or search narrows the tree, so hiding a
   * sibling cannot renumber the ones left. Reordering the steps does renumber
   * them, which is the point of an outline and the reason it is not a handle.
   */
  outline: string;
  children: PlanNode[];
  /** The steps this one is declared to wait on, done or not. */
  dependsOn: PlanLink[];
  /** The steps declared to wait on this one. */
  blocks: PlanRef[];
  /**
   * What actually holds it up: its own unfinished dependencies and those of
   * every step above it. A feature that waits on another waits with all of
   * its steps, whether or not each one says so.
   */
  waitingOn: PlanRef[];
  /** Over the leaf steps beneath it. `live` is 0 on a step with none. */
  rollup: PlanProgress;
  /** Could be started now. See `isReady` for the rule. */
  ready: boolean;
  /**
   * Under a view's filter: whether this step is one the view asked for, or
   * is shown only because something beneath it is.
   */
  matches: boolean;
};

/** One module's plan, and how far through it is. */
export type PlanSection = {
  module: ModuleId | null;
  label: string;
  nodes: PlanNode[];
  /**
   * Over the leaf steps of every plan in the module still being worked,
   * whatever the view is filtered to. A view narrows what is listed, not what
   * is true of the module; a plan closed top to bottom leaves the count
   * altogether, because it is archive rather than work.
   */
  progress: PlanProgress;
  /** The states of those same steps, counted. */
  tally: PlanTally;
  /** Those same states again, as the bands of the progress bar. */
  bands: PlanBand[];
};

export const PLAN_VIEWS = [
  'all',
  'open',
  'you',
  'ready',
  'proposed',
  'claude',
  'blocked',
  'fog',
  'dismissed',
] as const;
export type PlanView = (typeof PLAN_VIEWS)[number];

export function isPlanView(value: string): value is PlanView {
  return (PLAN_VIEWS as readonly string[]).includes(value);
}

/**
 * The views drawn as chips, in the order they sit on the row -- #516's answer.
 *
 * Nine chips over a page whose question is usually "what am I on", "what could
 * I pick up" or "what is waiting on me". These five answer those and give the
 * way back to the whole plan; the rest are a press further away in the menu
 * beside them, and the counts along the summary strip link to most of them
 * anyway.
 */
export const PLAN_VIEW_CHIPS = ['open', 'ready', 'you', 'claude', 'all'] as const;

/** Every other view, in the menu at the end of the chip row. */
export const PLAN_VIEW_MENU: readonly PlanView[] = PLAN_VIEWS.filter(
  (view) => !(PLAN_VIEW_CHIPS as readonly PlanView[]).includes(view),
);

export const PLAN_VIEW_LABEL: Record<PlanView, string> = {
  all: 'Everything',
  open: 'Open',
  you: 'On you',
  ready: 'Ready',
  proposed: 'Proposed',
  claude: "Dash's",
  blocked: 'Waiting',
  fog: 'Not specified',
  dismissed: 'Dismissed',
};

/** The numbers across the whole plan, for the strip at the top of the page. */
export type PlanSummary = {
  total: number;
  /**
   * Everything not finished: not done, not dropped.
   *
   * Proposals are in it. They used to be left out, on the grounds that nobody
   * had decided on them yet -- but that made the number disagree with the
   * Open view standing next to it, which has always listed them, and it made
   * "open" mean "open except for the part nobody has looked at", which is the
   * part most worth knowing about. A proposal is outstanding work in the only
   * sense the word is used here: it is not done, and somebody has to deal
   * with it.
   *
   * `planProgress` still leaves proposals out of its denominator, and that is
   * a different question -- how far through the decided work a module is,
   * which a proposal nobody has approved should not be holding back.
   */
  open: number;
  /** Open steps that cannot move until the person acts. See `needsThePerson`. */
  onYou: number;
  /** Written by a session, waiting on a person. */
  proposed: number;
  inProgress: number;
  /** Blocked by hand, or waiting on another step. */
  waiting: number;
  ready: number;
  done: number;
  /** Open steps handed to Claude. */
  claude: number;
  /** Steps carrying a "not yet specified" note, closed ones included. */
  fog: number;
  /** Rows put aside, and rows whose fog was. The only count they appear in. */
  dismissed: number;
};

/**
 * How far through a set of steps is.
 *
 * Dropped steps leave the denominator, because a step you decided against is
 * not work outstanding and counting it would hold a finished module at 90%
 * forever. Proposed steps leave it too: nobody has decided on them yet, and
 * a proposal that never gets approved should not have been holding a module
 * at 60% in the meantime. A set whose every step is one of those has no
 * fraction at all rather than a division by zero dressed up as 0%.
 *
 * In-progress counts as started and not as finished. Half-credit would make
 * the bar move when nothing shipped, which is the specific lie a progress bar
 * is worth having only if it does not tell.
 */
export function planProgress(
  items: readonly {
    status: PlanStatus;
    dependsOn?: readonly PlanLink[];
    dismissedAt?: string | null;
    /** Read by `isBlocked` for the blocked count. Absent reads as `outside`. */
    blockKind?: PlanBlockKind | null;
  }[],
): PlanProgress {
  // A dismissed question is out of the denominator with the proposals and the
  // dropped steps. It is not work anybody is doing, and counted it would hold
  // a feature below 100% for as long as it stayed put aside.
  const live = items.filter(
    (item) =>
      item.status !== 'dropped' &&
      item.status !== 'proposed' &&
      !isDismissed({ dismissedAt: item.dismissedAt ?? null }),
  );
  const done = live.filter((item) => item.status === 'done').length;
  const inProgress = live.filter((item) => item.status === 'in_progress').length;
  const blocked = live.filter((item) => isBlocked(item)).length;

  return {
    done,
    inProgress,
    blocked,
    live: live.length,
    fraction: live.length === 0 ? null : done / live.length,
  };
}

export function toRef(item: PlanItem): PlanRef {
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    status: item.status,
    module: item.module,
  };
}

/** Reading order among siblings: position, then age, then the number. */
function bySibling(a: PlanItem, b: PlanItem): number {
  return (
    a.position - b.position ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.number - b.number
  );
}

/**
 * A block on steps that have all closed.
 *
 * `blocked` covers two different waits and `block_kind` is what tells them
 * apart. A `steps` block is waiting on the rows in `plan_dependencies` it was
 * written with, and it is the only kind that can go out of date on its own:
 * once every step it named is closed, nothing recorded is holding it. #20 sat
 * blocked on #127 for a day after #127 shipped, and the page went on saying
 * "Waiting" with nothing left to wait on, which is the bug this answers.
 *
 * An `outside` block is never stale, however much else closes. #499 named
 * #495, #498 and #522, all three closed, and its block was about a GitHub
 * token nobody had made: the page called it ready, the Send button took the
 * press, and three runs came back having found the same wall. #525 settled
 * that by recording the kind, so this reading is no longer a guess.
 *
 * A block with no kind recorded reads as `DEFAULT_BLOCK_KIND`, which is
 * `outside`. The database refuses a blocked row without a kind, so nothing can
 * write one now, but a row whose kind this build does not recognise reads back
 * as null, and leaving such a step blocked is the safe way to be wrong.
 *
 * A step blocked with no dependencies at all is untouched whatever its kind:
 * there is nothing on record for it to have outlived.
 */
export function isStaleBlock(node: {
  status: PlanStatus;
  dependsOn?: readonly PlanLink[];
  blockKind?: PlanBlockKind | null;
}): boolean {
  if (node.status !== 'blocked') return false;
  if (!waitsOnItsSteps(node)) return false;
  const dependsOn = node.dependsOn ?? [];
  return dependsOn.length > 0 && dependsOn.every((link) => isClosed(link.item.status));
}

/**
 * Blocked, and still blocked on something.
 *
 * The status column on its own is not the answer to "is this held up", and
 * every count and filter that asked it that way disagreed with the row it was
 * counting: #20 sat with both of its dependencies closed, so its badge read
 * "Ready" while the summary said "1 waiting" and the Waiting view listed it
 * with nothing left to show as the thing it waits for. One of those was wrong
 * and it was the count -- `isStaleBlock` had been taught to `healthOf` and
 * `isReady` and to nothing else.
 *
 * So this is the question to ask anywhere the page speaks about blocked work.
 * `status === 'blocked'` is still the right test for the status *column* --
 * the dropdown says Blocked because that is what the row says, and it is the
 * person's to change.
 */
export function isBlocked(node: {
  status: PlanStatus;
  dependsOn?: readonly PlanLink[];
  blockKind?: PlanBlockKind | null;
}): boolean {
  return node.status === 'blocked' && !isStaleBlock(node);
}

/**
 * Whether a step could be picked up now.
 *
 *  - It has not been started. A step underway is being worked, not waiting
 *    to be, and a blocked one has said why it cannot be -- unless it was
 *    blocked on steps and every one of them has since closed, which is
 *    `isStaleBlock`. A block on something outside the plan never becomes
 *    ready here; it waits for the person to say it is over.
 *  - Nothing it waits on, its own or inherited, is still open.
 *  - None of its own steps are still open. A feature with steps outstanding
 *    is worked through those steps; the feature itself is what you close when
 *    they are all done.
 *  - Nothing above it is dropped, still proposed, or blocked on something
 *    outside the plan. A step under a dropped feature is dropped in all but
 *    the column, one under a proposal has not been agreed to, and one under a
 *    feature waiting on a credential nobody has made is waiting on it too.
 *
 *    A feature blocked on its own steps is the case that does not carry down.
 *    That block is waiting on the rows beneath it, so taking them out of the
 *    ready list is what keeps it blocked: #494 and #578 were each marked
 *    blocked over a question on one step, and between them they hid five
 *    priority-one features from the runner for a day. What a step actually
 *    waits on is on record as a dependency and is inherited down the tree by
 *    `buildPlanTree`, so the steps genuinely held up stay held up without the
 *    parent's status standing in for all of them.
 */
export function isReady(
  node: Pick<PlanNode, 'status' | 'waitingOn' | 'children' | 'dependsOn' | 'blockKind'>,
  ancestors: readonly Pick<PlanItem, 'status' | 'blockKind'>[],
): boolean {
  if (node.status !== 'not_started' && !isStaleBlock(node)) return false;
  if (node.waitingOn.length > 0) return false;
  // A dismissed step is not one of the steps outstanding. Left in, a question
  // put aside would hold its feature open for good, which is the opposite of
  // what dismissing it was for.
  if (node.children.some((child) => !isClosed(child.status) && !isDismissed(child))) return false;
  if (ancestors.some((a) => a.status === 'dropped' || a.status === 'proposed')) return false;
  if (ancestors.some((a) => a.status === 'blocked' && !waitsOnItsSteps(a))) return false;
  return true;
}

/**
 * A block that the steps beneath it can clear.
 *
 * The same reading `isStaleBlock` takes of a step's own block, asked of a
 * parent: `steps` means the wait is on rows that are on the plan, and every
 * other kind -- including a kind this build does not recognise, which reads
 * back as null -- means the wait is on the person.
 */
function waitsOnItsSteps(node: { blockKind?: PlanBlockKind | null }): boolean {
  return (node.blockKind ?? DEFAULT_BLOCK_KIND) === 'steps';
}

/**
 * The flat rows as a tree, one section per module.
 *
 * Every module gets a section whether or not it has steps yet, because an
 * empty section is the invitation to write the plan for it — a module that
 * simply did not appear would read as one nobody is allowed to plan. The
 * app-wide section only once something is in it: unlike a module, it is not
 * a place anybody expects to find a plan waiting to be written.
 *
 * A step whose parent is missing — which the cascade should make impossible —
 * is shown at the top of its module rather than lost, because a plan that
 * quietly hides a row is worse than one with a row out of place.
 */
export function buildPlanTree(data: PlanData, liveness?: PlanLiveness): PlanSection[] {
  const byId = new Map(data.items.map((item) => [item.id, item]));
  const childrenOf = new Map<string | null, PlanItem[]>();
  for (const item of data.items) {
    const parent = item.parentId && byId.has(item.parentId) ? item.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(item);
    childrenOf.set(parent, list);
  }
  for (const list of childrenOf.values()) list.sort(bySibling);

  const dependsOn = new Map<string, PlanLink[]>();
  const blocks = new Map<string, PlanRef[]>();
  for (const dep of data.dependencies) {
    const item = byId.get(dep.itemId);
    const target = byId.get(dep.dependsOnId);
    if (!item || !target) continue;
    dependsOn.set(item.id, [
      ...(dependsOn.get(item.id) ?? []),
      { dependencyId: dep.id, item: toRef(target) },
    ]);
    blocks.set(target.id, [...(blocks.get(target.id) ?? []), toRef(item)]);
  }

  function build(
    item: PlanItem,
    ancestors: PlanItem[],
    inherited: PlanRef[],
    outline: string,
  ): PlanNode {
    const own = (dependsOn.get(item.id) ?? [])
      .map((link) => link.item)
      .filter((ref) => !isClosed(ref.status));
    const seen = new Set(inherited.map((ref) => ref.id));
    const waitingOn = [...inherited, ...own.filter((ref) => !seen.has(ref.id))];

    const chain = [...ancestors, item];
    const children = (childrenOf.get(item.id) ?? []).map((child, index) =>
      build(child, chain, waitingOn, `${outline}.${index + 1}`),
    );

    const node: PlanNode = {
      ...item,
      depth: ancestors.length,
      outline,
      children,
      dependsOn: (dependsOn.get(item.id) ?? []).sort((a, b) => a.item.number - b.item.number),
      blocks: (blocks.get(item.id) ?? []).sort((a, b) => a.number - b.number),
      waitingOn,
      rollup: planProgress(leavesOf(children)),
      ready: false,
      matches: true,
    };
    node.ready = isReady(node, ancestors);
    return node;
  }

  const roots = (childrenOf.get(null) ?? []).map((item) =>
    build(item, [], [], String(item.number)),
  );

  const scopes: Array<ModuleId | null> = [...MODULES.map((module) => module.id), null];
  return scopes
    .map((scope) => {
      const nodes = roots.filter((node) => node.module === scope);
      // The heading counts what is still being worked, not what the module has
      // ever contained. A plan that is closed top to bottom leaves the icons
      // and the bar entirely -- 101 of the 110 features here are in that state,
      // and counting them made every module read as nine tenths finished
      // forever, which is a fact about the archive rather than about the work.
      //
      // The filter is at the plan, not at the step: a done step inside a plan
      // still being worked is exactly what the bar is for, and it stays.
      const working = nodes.filter((node) => !isFinishedFeature(node));
      return {
        module: scope,
        label: scope ? (MODULES.find((m) => m.id === scope)?.label ?? scope) : 'The app as a whole',
        nodes,
        progress: planProgress(leavesOf(working)),
        tally: tallyHealth(working, liveness),
        bands: planBands(working, liveness),
      };
    })
    .filter((section) => section.module !== null || section.nodes.length > 0);
}

/** The steps with no steps of their own, beneath these. */
export function leavesOf(nodes: readonly PlanNode[]): PlanNode[] {
  return nodes.flatMap((node) => (node.children.length === 0 ? [node] : leavesOf(node.children)));
}

/**
 * What state a step is actually in, as one word.
 *
 * This is not `node.status`. A question and a step share the status column but
 * do not mean the same things by it -- an unfinished decision is not "not
 * started", it is unanswered, and it closes on an answer rather than on a
 * commit. Nor is "ready" a status: it is worked out from what a step waits on
 * and what sits beneath it.
 *
 * It lives here rather than in the page because the page is no longer the only
 * thing asking. The counts beside a module heading count these, and a tally
 * that classified steps by its own slightly different rules would disagree
 * with the health column directly beneath it, on the same screen, about the
 * same step. The page keeps the wording and the tooltip, lib/status-glyphs.ts
 * keeps the shape; the rule is here.
 */
/**
 * The fourteen, and why each one is here.
 *
 * #505 asked whether the set had outgrown what anybody reads: `not_started`,
 * `ready` and `waiting` look like three shapes for "not started, and here is
 * why". It was measured against one bar -- a health stays only if some surface
 * does something different with it, rather than merely wording it differently
 * -- and all fourteen cleared it. Five pairs were close enough to argue about:
 *
 * - `ready` against `not_started`. `ready` is what the Send button takes, what
 *   `workOrder` lists and what the overnight chooser fires. Merging them puts
 *   the one state that is an invitation to start behind a tooltip.
 * - `waiting` against `blocked`. Since #565 a `blocked` row can have every
 *   dependency closed, and a `waiting` row has no block of its own, so they
 *   are no longer one fact read twice: one clears itself when the steps it
 *   names close, the other waits for the person.
 * - `in_progress` against `working`. The column words both "In progress" and
 *   draws both three-quarters, which is deliberate -- they are the same rung,
 *   and the live indicator on the row says which off the same reading. What
 *   separates them is evidence, and dropping `in_progress` means calling a
 *   claim nobody has looked into "working", which is the dot the page used to
 *   draw on a step nobody was working.
 * - `answered` against `done`. A settled question carries a resolution and no
 *   commit, its tooltip is that resolution, and it is the one state the counts
 *   beside a module heading leave out.
 * - `setup` against `blocked`. Both are stopped on you and neither moves until
 *   you act, but they are not the same thing to read: a blocked step is a
 *   build that ran into a wall, and a setup step is a job that was always
 *   yours and was written as one. The difference is what Dash does with them
 *   -- #599 asked for a section you can finish a setup job from without
 *   leaving the tab -- and a job on your list reading as a build somebody got
 *   stuck on is what this whole feature is about.
 *
 * Every `Record<PlanHealth, ...>` is exhaustive -- the glyphs, the words, the
 * tally, `planState` -- so a fifteenth fails the typecheck at each surface
 * rather than drawing itself as a proposal. The same bar applies to it.
 */
export const PLAN_HEALTHS = [
  // A question, and a question settled. A decision shares the status column
  // with a step and does not mean the same things by it: an open one is not
  // "not started", and a closed one carries an answer rather than a commit.
  'unanswered',
  'answered',
  // Written by a session, waiting on the person. Out of the progress
  // denominator and out of the bands, which is what separates it from
  // `not_started`.
  'proposed',
  // A job that is yours: an account to open, a key to paste, a switch to flip
  // somewhere outside the repo. Open until you have done it, and no session
  // can do it for you -- which is why it is a state of its own rather than a
  // step that reads `ready` and gets claimed by the next routine to look.
  'setup',
  // The four readings of a claim. `in_progress` is a claimed row with nothing
  // known about the run behind it; the other three are what the run says,
  // through `claimLiveness`. `abandoned` is the one that leaves the ladder --
  // the step is claimed and nothing is working it.
  'in_progress',
  'working',
  'quiet',
  'abandoned',
  // Stopped on something outside the plan, and waiting on a step that will
  // clear itself. `isStaleBlock` is what keeps the two apart.
  'blocked',
  'waiting',
  // Not started, with and without something in the way.
  'ready',
  'not_started',
  // Closed. `dropped` leaves the denominator; `done` is the one that carries
  // a commit.
  'done',
  'dropped',
] as const;
export type PlanHealth = (typeof PLAN_HEALTHS)[number];

/**
 * What each claimed step's session is doing, by step id.
 *
 * The one thing `healthOf` cannot work out from the plan: whether the session
 * that claimed a step is still pushing. It comes off the run rows, so it is
 * handed in rather than derived, and it is optional everywhere -- a caller
 * with no runs to hand asks without it and every claim reads `in_progress`,
 * which is what the whole plan did before there was anything better to say.
 */
export type PlanLiveness = Readonly<Record<string, ClaimLiveness>>;

/**
 * The claims on these steps, read against the last run on each.
 *
 * Built once and handed to `buildPlanTree`, `healthOf` and the guards, because
 * the alternative is each of them reading the run rows its own way. A step
 * with no run against it still gets an entry when it is claimed: the clock is
 * the fallback and `claimLiveness` applies it.
 */
export function planLiveness(
  steps: readonly (ClaimStep & { id: string })[],
  runs: Readonly<Record<string, ClaimRun>>,
  now: number,
): PlanLiveness {
  const out: Record<string, ClaimLiveness> = {};
  for (const step of steps) {
    const reading = claimLiveness(step, runs[step.id], now);
    if (reading) out[step.id] = reading;
  }
  return out;
}

/**
 * Which open state speaks for a subtree, most pressing first.
 *
 * Only consulted for a closed row that still has open rows beneath it, and
 * only to pick which of them to report. The order is "how much does this stop
 * the work": a question nobody has answered, then a step that said what is
 * holding it up, then a proposal nobody has accepted, and so on down to a step
 * simply not reached yet.
 */
const OPEN_HEALTH_RANK: readonly PlanHealth[] = [
  'unanswered',
  // Beside the question and above the block, because both are on your desk
  // and this is the one you can finish tonight: nothing is being worked out,
  // there is a job with your name on it.
  'setup',
  'blocked',
  // A claim nobody is working is more pressing than a proposal: the step has
  // been handed over and stopped, so it needs sending again, and a feature
  // reporting the proposal beneath it instead would hide that.
  'abandoned',
  'proposed',
  'waiting',
  'quiet',
  'working',
  'in_progress',
  'ready',
  'not_started',
];

/** Every row beneath this one, at any depth. */
function descendantsOf(node: { children?: readonly PlanNode[] }): PlanNode[] {
  return (node.children ?? []).flatMap((child) => [child, ...descendantsOf(child)]);
}

export function healthOf(
  node: Pick<PlanNode, 'kind' | 'status' | 'waitingOn' | 'ready' | 'dependsOn' | 'blockKind'> & {
    /**
     * Optional so the callers that classify one row on its own -- the tally,
     * which only ever sees leaves -- need not build a subtree to ask.
     */
    children?: readonly PlanNode[];
    /**
     * Only read to look this row's claim up in `liveness`. Optional for the
     * callers that classify a row without one in hand, `needsThePerson` among
     * them, and a row with no id simply has no reading.
     */
    id?: string;
  },
  /**
   * What the runs say about the claimed steps, from `planLiveness`. Without
   * it a claim reads `in_progress` and nothing more, which is all the status
   * column can support on its own.
   */
  liveness?: PlanLiveness,
): PlanHealth {
  // Closed on top of something open is not closed.
  //
  // A feature finished months ago can acquire a new row: #194, a question, was
  // added under #152 after it shipped, and the page went on saying "Done"
  // because that is what #152's own status column said. Health is meant to be
  // what the row means right now, so it reports the most pressing thing still
  // open beneath it instead -- and reports it deterministically, from the
  // subtree, rather than from when anybody last edited the parent.
  //
  // Dropped as well as done: a step decided against with live work under it is
  // the same wrong answer, and the open rows are the ones that need seeing.
  if (isClosed(node.status)) {
    const open = descendantsOf(node).filter(
      (child) => !isClosed(child.status) && !isDismissed(child),
    );
    if (open.length > 0) {
      const healths = new Set(open.map((child) => healthOf(child, liveness)));
      const worst = OPEN_HEALTH_RANK.find((health) => healths.has(health));
      if (worst) return worst;
    }
  }

  // A decision not yet settled is a question, whatever else is true of it.
  // "Ready" on a question would read as ready to be built, which is the one
  // thing it is not: nothing happens to it until somebody answers it.
  if (node.kind === 'decision' && !isClosed(node.status) && node.status !== 'blocked') {
    return 'unanswered';
  }
  if (node.kind === 'decision' && node.status === 'done') return 'answered';

  // A setup job you have not done is a setup job, whatever the status column
  // says. "Ready" on one would read as ready for a session to pick up, which
  // is the one thing it is not: it is an account to open or a key to paste,
  // and nothing happens to it until you do it.
  //
  // Except while it is genuinely blocked, which is the same exception a
  // decision makes. A block carries the one sentence saying what the step
  // needs right now, and that is more specific than "this is a setup job". A
  // stale block is not that case -- `isBlocked` is already false once the
  // steps it named have closed -- so the step goes back to reading `setup`
  // rather than falling through to `ready`.
  if (node.kind === 'setup' && !isClosed(node.status) && !isBlocked(node)) return 'setup';

  // A block on steps that have all closed is reported as the step it now is,
  // not as the block it used to be. See `isStaleBlock`: leaving it as
  // "Waiting" is the page claiming something is holding the step up when the
  // plan has no record of anything that is. A block on something outside the
  // plan is not that case -- it goes on reading `blocked` below, because the
  // thing holding it up was never on the plan to close.
  if (isStaleBlock(node)) {
    return node.ready ? 'ready' : 'not_started';
  }

  switch (node.status) {
    case 'proposed':
      return 'proposed';
    // What the claim actually means, where the run behind it has been read.
    //
    // `in_progress` is one word for four situations -- a session pushing right
    // now, a session that has gone twenty minutes without pushing, a run that
    // died hours ago and never closed the step, and a claim nothing has ever
    // looked into. The column cannot tell them apart, so every surface that
    // read it alone drew a pulsing dot on a step nobody was working. The run
    // record can, and `claimLiveness` is where that is decided.
    case 'in_progress':
      switch (node.id ? liveness?.[node.id] : undefined) {
        case 'working':
          return 'working';
        case 'quiet':
          return 'quiet';
        case 'abandoned':
          return 'abandoned';
        default:
          return 'in_progress';
      }
    case 'blocked':
      return 'blocked';
    case 'done':
      return 'done';
    case 'dropped':
      return 'dropped';
    case 'not_started':
      if (node.waitingOn.length > 0) return 'waiting';
      // A feature is blocked when nothing beneath it can move.
      //
      // Since `isReady` stopped letting a feature's own blocked column hold
      // its steps down, that column is no longer where a feature's block
      // comes from -- it comes from the steps, the same way progress and
      // "started" already do. A feature whose every open step is blocked has
      // nothing anybody can pick up, and reading "Not started" over five
      // stopped steps is the plan describing itself wrongly on the one screen
      // that is opened to find what is stuck.
      //
      // Every open step, not any: one blocked step beside a step that can be
      // worked leaves the feature open, which is the whole point.
      if (blockedBeneath(node)) return 'blocked';
      // Work has plainly started once some of it is finished.
      //
      // A feature's own status column is set by hand and mostly never is: it
      // is created `not_started` and left there while the steps beneath it are
      // picked up and closed one at a time. So a feature with four of seven
      // steps done went on reading "Not started", which is the one thing it
      // demonstrably is not, and the progress bar beside it said so on the
      // same line.
      //
      // Read from the subtree rather than from the row, the same way the
      // closed-over-open case above is, so it is a fact about the plan instead
      // of a fact about when somebody last edited a parent.
      if (startedBeneath(node)) return 'in_progress';
      return node.ready ? 'ready' : 'not_started';
  }
}

/**
 * Whether any real work beneath this row has been picked up or finished.
 *
 * Decisions are excluded: answering a question is not building the thing, and
 * a feature whose only closed row is its own opening question has not started.
 * Dismissed rows are excluded for the reason they always are -- putting a row
 * aside is how it stops counting.
 */
/**
 * Every open row beneath this one is blocked, and there is at least one.
 *
 * `isBlocked` rather than the status column, so a step whose block named steps
 * that have all since closed counts as one that can move -- it is about to be
 * offered to the runner, and a feature reading blocked over it would be
 * reporting a wait the plan no longer has a record of.
 *
 * Dismissed rows are out for the reason they always are: putting a row aside
 * is how it stops counting.
 */
function blockedBeneath(node: { children?: readonly PlanNode[] }): boolean {
  const open = descendantsOf(node).filter(
    (child) => !isClosed(child.status) && !isDismissed(child),
  );
  return open.length > 0 && open.every((child) => isBlocked(child));
}

function startedBeneath(node: { children?: readonly PlanNode[] }): boolean {
  return descendantsOf(node).some(
    (child) =>
      child.kind !== 'decision' &&
      !isDismissed(child) &&
      (child.status === 'in_progress' || child.status === 'done'),
  );
}

/* -------------------------------------------------------------------------
 * Whose move it is
 * ---------------------------------------------------------------------- */

/**
 * The second column, and the reason there are now two.
 *
 * Health says how far along a row is -- not started, underway, done. It does
 * not say what would move it, and those two questions had been sharing one
 * word: "Blocked" is a state of progress and also a statement about who has to
 * act, "Ready" means both "nothing is stopping it" and "a session could take
 * it", and a step a session is working on right now looked exactly like a step
 * you started yourself last week. So the page could not answer the question it
 * is opened to answer, which is "what is Dash on, and what is on me".
 *
 * Called a move rather than a status in the code, because `status` is already
 * the raw column a person sets by hand and a third meaning for that word is
 * how the first two got confused. The page labels the column Status, which is
 * what it is to read.
 *
 * Every rule here is already written down somewhere else and is reused rather
 * than restated: `needsThePerson` for what is yours to answer, `waitingOn` for
 * what another step is holding up, and the `assignee` you set by marking a
 * step yours. Two implementations of "is this Dash's" would disagree by next
 * month, and the disagreement would be between a column and the button beside
 * it.
 *
 * A row gets a word only when something is happening to it (#694). An approved
 * step waiting its turn is the ordinary case on this page, and the health
 * column beside it already says it is ready, so its move is `none` and the
 * cell stays empty.
 */
export const PLAN_MOVES = [
  'resolving',
  'on_you',
  'with_dash',
  'yours',
  'waiting',
  'none',
  'settled',
] as const;
export type PlanMove = (typeof PLAN_MOVES)[number];

/**
 * What the move cannot be worked out from the tree alone.
 *
 * `resolving` is the only one: a re-shape is a run against a feature, and a
 * run is a row in another table. Passed in as the ids rather than read here,
 * because this file is pure and the page is what holds the runs.
 */
export type MoveContext = {
  /** Feature ids a re-shape is running against right now. */
  resolving?: ReadonlySet<string>;
};

/**
 * Most pressing first, and so the order a parent reports from.
 *
 * "On you" outranks everything because it is the only one that stops on your
 * desk. A session working now outranks a step you marked yours, which outranks
 * one another step is holding up. `none` comes last of the open moves because
 * it is the absence of a move: anything else beneath a feature is the thing
 * the feature has to report.
 */
const MOVE_RANK: readonly PlanMove[] = [
  'resolving',
  'on_you',
  'with_dash',
  'yours',
  'waiting',
  'none',
  'settled',
];

/** This row alone, ignoring everything beneath it. */
function ownMove(node: MoveInput, context?: MoveContext): PlanMove {
  // First, and above even "on you", because it is the one state that is true
  // of the whole feature right now and the only one with something to say
  // about what a press would do. A re-shape writes proposed rows as it goes,
  // and each of those is a thing to approve -- so ranked any lower, a feature
  // would flip to "On you" halfway through a run that is still rewriting it,
  // and the questions it is about to raise would be answered against a plan
  // that is mid-edit. It clears when the run does.
  if (context?.resolving?.has(node.id)) return 'resolving';
  if (isClosed(node.status) || isDismissed({ dismissedAt: node.dismissedAt ?? null })) {
    return 'settled';
  }
  // A question to answer, a proposal to approve, or a step blocked on
  // something only you can supply. One rule, shared with the "On you" view.
  if (needsThePerson(node)) return 'on_you';
  if (node.waitingOn.length > 0) return 'waiting';
  // `assignee` says one thing now: you marked this and the runner will not
  // take it. That is true whether or not the step has been started, so it is
  // read before the status -- a step you kept and then began is still yours,
  // not with a session.
  if (node.assignee === 'me') return 'yours';
  if (node.status === 'in_progress') return 'with_dash';
  // Approved, ready, nothing on it. The runner will fire it when it reaches
  // it, and until then there is no move to report.
  return 'none';
}

type MoveInput = Pick<
  PlanNode,
  'id' | 'kind' | 'status' | 'waitingOn' | 'ready' | 'dependsOn' | 'assignee' | 'blockKind'
> & {
  dismissedAt?: string | null;
  children?: readonly PlanNode[];
};

/**
 * Whose move it is on this row or anything beneath it.
 *
 * Over the subtree, because a feature is a container and what is happening to
 * it is what is happening inside it: a feature whose third step is with a
 * session right now is with a session, and saying "Yours" because nobody
 * assigned the feature row itself is how the old column managed to be true and
 * useless at once. Closed rows report from beneath them too, for the same
 * reason `healthOf` does -- a question added under a shipped feature is still
 * a question.
 */
export function moveOf(node: MoveInput, context?: MoveContext): PlanMove {
  const rows: MoveInput[] = [node, ...descendantsOf(node)];
  const moves = new Set(
    rows
      .filter((row) => !isDismissed({ dismissedAt: row.dismissedAt ?? null }))
      .map((row) => ownMove(row, context)),
  );
  return MOVE_RANK.find((move) => moves.has(move)) ?? 'settled';
}

/** How many steps are in each state. Every health has an entry, most of them 0. */
export type PlanTally = Record<PlanHealth, number>;

/**
 * The states of a module's steps, counted.
 *
 * Over the leaves, which is the same set `planProgress` measures, and for the
 * same reason: a feature's state is mostly a summary of the steps under it, so
 * counting both says "twelve things" about a module that has seven. Questions
 * are leaves and so are counted -- an unanswered one is exactly the kind of
 * thing this is meant to surface without being opened. A dismissed one is not:
 * the count beside a module heading is one of the places it stopped being
 * asked about.
 */
export function tallyHealth(nodes: readonly PlanNode[], liveness?: PlanLiveness): PlanTally {
  const tally = Object.fromEntries(PLAN_HEALTHS.map((health) => [health, 0])) as PlanTally;
  for (const leaf of leavesOf(nodes)) {
    if (isDismissed(leaf)) continue;
    tally[healthOf(leaf, liveness)] += 1;
  }
  return tally;
}

/**
 * The order the progress bar draws its states in, left to right.
 *
 * Finished at the left and untouched at the right, with everything else
 * between them in the order work actually moves: done, an answered question,
 * underway, ready to pick up, then the stuck states and the ones sitting on
 * you, then not reached.
 * A bar whose bands moved around as the counts changed would be a different
 * picture every week, so the order is fixed here and never sorted by size.
 *
 * `proposed` and `dropped` are absent because they are not in the denominator
 * -- see `planProgress`. Drawing them would put the bar and the "8 of 12"
 * beside it into disagreement about how many steps a module has.
 */
export const PLAN_BAND_ORDER: readonly PlanHealth[] = [
  'done',
  'answered',
  'working',
  'quiet',
  'in_progress',
  'ready',
  // With the stuck states rather than with the underway ones: a claim whose
  // run ended is not work in hand, it is a step waiting to be handed over
  // again.
  'abandoned',
  'blocked',
  'unanswered',
  // In the bar, not out of it like `proposed`: a setup job is agreed work in
  // the denominator, and leaving it out would make the bands stop summing to
  // the "8 of 12" beside them.
  'setup',
  'waiting',
  'not_started',
];

/** One band of the progress bar: a state, and how much of the bar it owns. */
export type PlanBand = { health: PlanHealth; count: number };

/**
 * A module's live steps by state, as the bands of one bar.
 *
 * The bar used to be a single green length: the done fraction, and everything
 * else undifferentiated track. That is one number, and it hid the shape of
 * what was left -- eleven steps nobody has started and eleven questions
 * waiting on an answer drew exactly the same bar and are not remotely the same
 * module. The tally beside it already said which; this makes the bar say it
 * too, in the tones the health column under it is already using.
 *
 * Over the same live leaves `planProgress` measures, and classified by the
 * same `healthOf` the tally and the health column use, so the bands sum to
 * `progress.live` and no two things on this row can disagree. Empty states are
 * dropped: a band of zero is nothing to draw and nothing to say (law 1).
 */
export function planBands(nodes: readonly PlanNode[], liveness?: PlanLiveness): PlanBand[] {
  const live = leavesOf(nodes).filter(
    (leaf) => leaf.status !== 'dropped' && leaf.status !== 'proposed',
  );

  const counts = new Map<PlanHealth, number>();
  for (const leaf of live) {
    const health = healthOf(leaf, liveness);
    counts.set(health, (counts.get(health) ?? 0) + 1);
  }

  return PLAN_BAND_ORDER.filter((health) => (counts.get(health) ?? 0) > 0).map((health) => ({
    health,
    count: counts.get(health) as number,
  }));
}

/** Every step in reading order: top to bottom, each step before its steps. */
export function flatten(nodes: readonly PlanNode[]): PlanNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

export function flattenSections(sections: readonly PlanSection[]): PlanNode[] {
  return sections.flatMap((section) => flatten(section.nodes));
}

export function findNode(sections: readonly PlanSection[], id: string): PlanNode | null {
  return flattenSections(sections).find((node) => node.id === id) ?? null;
}

/** The step and everything beneath it, by id. */
export function subtreeIds(node: PlanNode): Set<string> {
  return new Set(flatten([node]).map((item) => item.id));
}

/** The steps above one, top first. Empty at the top of a module. */
export function ancestorsOf(sections: readonly PlanSection[], id: string): PlanNode[] {
  const nodes = flattenSections(sections);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: PlanNode[] = [];
  let current = byId.get(id)?.parentId ?? null;
  while (current) {
    const parent = byId.get(current);
    if (!parent || chain.includes(parent)) break;
    chain.unshift(parent);
    current = parent.parentId;
  }
  return chain;
}

/**
 * A step that cannot move until the person does something about it.
 *
 * Four kinds, and the test for each is "would anybody else be allowed to
 * settle this": an unanswered question is theirs by definition and a session
 * that answered one would be guessing with a paper trail; a proposal is a
 * session's suggestion and nothing happens to it until somebody says yes; a
 * blocked step is blocked with the exact thing it needs written on it, and
 * that thing is nearly always a person's to supply; a setup step is a job
 * outside the repo -- an account, a key, a switch -- and it is theirs from the
 * moment it is written rather than from the moment a session runs into it.
 *
 * A ready step assigned to them is deliberately not here. That is work they
 * could do, and mixing it in would make "everything waiting on you" a list you
 * cannot clear in an evening -- which is how a list like this stops being
 * opened. A setup step is the one piece of work that is here, and it is here
 * because nothing else can do it and something on the plan is waiting on it:
 * it was written as the person's job, which is exactly what a ready step
 * assigned to them was not.
 */
export function needsThePerson(
  node: Pick<PlanNode, 'kind' | 'status' | 'waitingOn' | 'ready' | 'dependsOn' | 'blockKind'> & {
    dismissedAt?: string | null;
  },
) {
  if (isClosed(node.status)) return false;
  // Dismissing is how a row stops being on you without being settled.
  if (isDismissed({ dismissedAt: node.dismissedAt ?? null })) return false;
  const health = healthOf(node);
  return (
    health === 'unanswered' ||
    health === 'proposed' ||
    health === 'blocked' ||
    health === 'setup'
  );
}

/**
 * A step the runner may take: one you approved and did not keep.
 *
 * The test here used to be `assignee === 'claude'`, so a step had to be handed
 * over by hand before any routine could see it. On the night of 18 September
 * sixteen of the twenty-four approved, ready build steps had no assignee at
 * all, and the run ended at 23:44 saying nothing was ready with two thirds of
 * the available work in front of it.
 *
 * Approving is the hand-over now (#669, #670), which leaves the assignee
 * column answering the narrower question it is good at: which approved steps
 * did you keep for yourself. `me` is the whole of that answer, so an empty
 * assignee and the `claude` every hand-over used to write read the same way.
 *
 * `proposed` is the other half of it, and it is what approving means: a
 * suggestion nobody has said yes to stays out of reach however it is
 * assigned. Everything past those two -- ready, open, not waiting on the
 * person -- is the caller's, because the three readers of this rule each want
 * a different amount of it.
 */
export function isClaudes(node: Pick<PlanNode, 'status' | 'assignee'>): boolean {
  return node.status !== 'proposed' && node.assignee !== 'me';
}

function matchesView(node: PlanNode, view: PlanView): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'open':
      return !isClosed(node.status);
    case 'you':
      return needsThePerson(node);
    case 'ready':
      return node.ready;
    case 'proposed':
      return node.status === 'proposed';
    case 'claude':
      return isClaudes(node) && !isClosed(node.status) && !isWaitingOnThePerson(node);
    case 'blocked':
      return !isClosed(node.status) && (isBlocked(node) || node.waitingOn.length > 0);
    // Closed steps included. A finished feature still carrying fog is the
    // case worth seeing: the work stopped and the gap it admitted to did not
    // get filled. Nothing else on the page shows that. A patch you have put
    // aside is not in it — that is what putting it aside meant.
    case 'fog':
      return hasLiveFog(node);
    // The one view that asks for what everything else hides: a question you
    // are not answering now, and a row whose fog you have put aside. Both,
    // because a feature can be here for its fog while it is otherwise live.
    case 'dismissed':
      return isDismissed(node) || node.fogDismissedAt !== null;
  }
}

/**
 * A dismissed row leaves every view but the one that looks for it, and takes
 * its own steps with it. Dropping it inside `matchesView` would not be enough:
 * a parent stays when a child matches, so a dismissed question would come back
 * the moment anything under it did.
 */
function prune(nodes: readonly PlanNode[], view: PlanView): PlanNode[] {
  return nodes.flatMap((node) => {
    if (isDismissed(node) && view !== 'dismissed') return [];
    const children = prune(node.children, view);
    const matches = matchesView(node, view);
    if (!matches && children.length === 0) return [];
    return [{ ...node, children, matches }];
  });
}

/**
 * The plan narrowed to a view.
 *
 * A step that does not match stays if something beneath it does, dimmed, so
 * the ones that match are still seen in their place: "Ready" showing a bare
 * sub-step with no feature over it would answer "what" and not "of what".
 * The module's progress is left over the whole plan, because a filtered view
 * has not changed how far through anything is.
 *
 * "Everything" is the only view that keeps a module with nothing in it. That
 * empty section is the invitation to plan the module, and a module that simply
 * did not appear anywhere would read as one nobody is allowed to plan. Every
 * other view drops it, "Open" included: four of the seven modules have nothing
 * open, and four headings you scroll past to reach the work are four too many
 * when the invitation is one click away.
 *
 * "Everything" goes through the same pruning rather than past it, because
 * dismissed rows are hidden from every view and it is a view.
 *
 * Nothing here reorders anything. Every view draws the modules in the fixed
 * order lib/modules.ts gives them and the features inside each one in the
 * plan's own order, which is the order they are numbered in.
 *
 * It used to sort both by what was touched last -- #507 for the features,
 * #517 for the sections -- so the thing you were working on rose to the top.
 * The cost turned out to be the thing the page is for: the plan stopped
 * having a shape. A module was wherever this morning left it, a feature moved
 * out from under you as you closed steps beneath it, and the same page read
 * differently every time it was opened, so nothing could be found twice in the
 * same place. A fixed order you can learn beats a helpful one you cannot, and
 * the views themselves are what narrow the page to what is being worked on.
 *
 * `prune` is still per view, and a view other than "Everything" still drops a
 * module with nothing left in it.
 */
export function applyView(sections: readonly PlanSection[], view: PlanView): PlanSection[] {
  const drawn = sections.map((section) => ({ ...section, nodes: prune(section.nodes, view) }));
  // "Everything" is the only view that keeps a module with nothing in it: the
  // empty section is the invitation to plan that module.
  return view === 'all' ? drawn : drawn.filter((section) => section.nodes.length > 0);
}

/**
 * A feature nobody is coming back to: closed itself, with nothing open under
 * it. About 101 of the plan's 110 top-level features are in this state, and
 * they are consulted rather than read -- "did I already plan that" -- so on
 * "Everything" they are gathered into one fold instead of running down the
 * page between the nine features that still have work in them.
 *
 * Dropped counts as closed here. A feature decided against is as finished as
 * one that shipped, and the row says which it was.
 */
export function isFinishedFeature(node: PlanNode): boolean {
  return isClosed(node.status) && !flatten(node.children).some((child) => !isClosed(child.status));
}

/** When a feature stopped being worked, for ordering the archive. */
function finishedAt(node: PlanNode): string {
  return node.completedAt ?? node.createdAt;
}

/**
 * "Everything", with the finished features lifted out of the modules.
 *
 * They come back as one list across every module, newest first, because that
 * is the order you look for them in: the thing you finished last week is the
 * thing you are trying to remember. The module's progress and tally do not
 * move with them: `buildPlanTree` already leaves a finished plan out of both,
 * so what the heading says is what is still in hand either way.
 *
 * Only worth calling on "Everything". Every other view has already dropped a
 * finished feature in `prune`, so there is nothing to lift out of it.
 */
export function splitFinished(sections: readonly PlanSection[]): {
  sections: PlanSection[];
  finished: PlanNode[];
} {
  const finished: PlanNode[] = [];
  const kept = sections.map((section) => {
    const nodes = section.nodes.filter((node) => {
      if (!isFinishedFeature(node)) return true;
      finished.push(node);
      return false;
    });
    return { ...section, nodes };
  });
  finished.sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)));
  return { sections: kept, finished };
}

/**
 * Whether a step answers a search.
 *
 * The number, the title and the detail, because those are the three ways
 * somebody refers to a step they are trying to find again: "#342", "the shelf
 * picker", or a phrase they remember writing into the detail. The number
 * matches with or without its hash, so typing `342` and `#342` both work.
 *
 * Every term has to match, and each may match a different field — "342 shelf"
 * finds the step only if it is both. Case and surrounding space are ignored.
 */
function matchesQuery(node: PlanNode, terms: readonly string[]): boolean {
  // The outline as well as the number: a step reads "595.2" on the page, so
  // that is what gets typed into the box after reading it.
  const haystack = [`#${node.number}`, node.outline, node.title, node.detail ?? '']
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** A query split into the terms every step has to carry. Empty when blank. */
export function searchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/^#/, ''))
    .filter(Boolean);
}

/** A whole subtree kept for context, so nothing under a hit reads as a hit. */
function asContext(nodes: readonly PlanNode[]): PlanNode[] {
  return nodes.map((node) => ({
    ...node,
    children: asContext(node.children),
    matches: false,
  }));
}

function pruneToQuery(nodes: readonly PlanNode[], terms: readonly string[]): PlanNode[] {
  return nodes.flatMap((node): PlanNode[] => {
    const matches = matchesQuery(node, terms);
    // A hit keeps the steps beneath it, the way opening the row would show
    // them: finding a feature and being handed it with its steps stripped out
    // is finding the wrong thing. They are context, not hits, so they are
    // marked as such -- otherwise the count would call a one-hit search seven.
    if (matches) return [{ ...node, children: asContext(node.children), matches: true }];

    const children = pruneToQuery(node.children, terms);
    if (children.length === 0) return [];
    return [{ ...node, children, matches: false }];
  });
}

/**
 * The plan narrowed to a search.
 *
 * The same shape as a view, and deliberately so: a step that does not match
 * stays if something beneath it does, dimmed, so a hit is still read in its
 * place rather than as a bare sub-step with no feature over it. `matches` is
 * the flag the row already dims on, so search needs nothing new to render.
 *
 * A blank query is not a search and gives the sections back untouched, so the
 * caller does not have to decide whether to call this.
 *
 * Modules with no hits are dropped, every view included -- unlike "Open",
 * which keeps an empty module because an empty module is an invitation to plan
 * it. Under a search it is only noise between results.
 */
export function searchSections(
  sections: readonly PlanSection[],
  query: string,
): PlanSection[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return sections.map((section) => ({ ...section }));

  return sections
    .map((section) => ({ ...section, nodes: pruneToQuery(section.nodes, terms) }))
    .filter((section) => section.nodes.length > 0);
}

/**
 * A search over steps that are not in a module section: the archive of
 * finished features on "Everything". The same rules as `searchSections`, so a
 * feature folded away is still found by number, title or detail.
 */
export function searchNodes(nodes: readonly PlanNode[], query: string): PlanNode[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [...nodes];
  return pruneToQuery(nodes, terms);
}

/** How many steps a search actually found, as opposed to kept for context. */
export function countMatches(sections: readonly PlanSection[]): number {
  return flattenSections(sections).filter((node) => node.matches).length;
}

/**
 * What to pick up next, in order.
 *
 * Every ready step, most urgent first, and within a priority in reading order
 * — the modules in the order the switcher lists them, then top to bottom, so
 * two steps of equal weight are taken in the order the plan was written. The
 * sort is stable, which is what makes "in reading order" true.
 *
 * With the exceptions `isWaitingOnThePerson` names, which is where the rule
 * lives rather than here. A decision is a question put to the person, and a
 * session that could pick one up would answer its own question — the whole
 * thing decisions exist to prevent. A setup step is a job only the person can
 * do, so a routine that claimed one would sit in front of an account nobody
 * has made and block itself to say so. (The third state it names, a live
 * block, never reaches this filter: a blocked step is not `ready` in the
 * first place.)
 *
 * Both stay ready and stay in the unfiltered order, so they show on the page
 * and hold up everything waiting on them until somebody settles them.
 *
 * `{ assignee: 'claude' }` asks for what the runner may take, which is
 * `isClaudes` rather than the column: every approved step but the ones you
 * kept. `{ assignee: 'me' }` is the column read literally, because those are
 * the ones you kept.
 */
export function workOrder(
  sections: readonly PlanSection[],
  options: { assignee?: PlanAssignee } = {},
): PlanNode[] {
  return flattenSections(sections)
    .filter((node) => node.ready)
    .filter((node) => !isDismissed(node))
    .filter((node) => {
      if (!options.assignee) return true;
      if (options.assignee === 'me') return node.assignee === 'me';
      return isClaudes(node) && !isWaitingOnThePerson(node);
    })
    .sort((a, b) => a.priority - b.priority);
}

/**
 * A step that is waiting on the person, and so cannot be Claude's.
 *
 * Three states, and all three mean the same thing: nothing a session does
 * moves this. An unanswered decision is a question put to the person, and a
 * session that picked one up would be answering its own question. A blocked
 * step said what it needs and it is outside the repo -- a credential, an
 * account, a choice -- so handing it over sends a session to sit in front of
 * the same wall. An open setup step is that same wall written down in advance:
 * the job is the person's, and a session sent at it can do nothing but block
 * itself.
 *
 * This is why a hand-over skips them and why they are unhanded when they get
 * there: a queue that lists work nobody can do is a queue that stops being
 * read. It supersedes the old "not a decision" exclusion, which caught half of
 * it -- a blocked step went on sitting in Claude's list with a reason written
 * on it saying why it could not be worked.
 *
 * Not the same set as `needsThePerson`, which also counts a proposal. A
 * proposal is a suggestion nobody has agreed to rather than work stuck on
 * something, and it is excluded from a hand-over on its own grounds.
 */
export function isWaitingOnThePerson(
  node: Pick<PlanNode, 'kind' | 'status'> & {
    dependsOn?: readonly PlanLink[];
    blockKind?: PlanBlockKind | null;
  },
): boolean {
  if (isBlocked(node)) return true;
  if (node.kind === 'setup' && !isClosed(node.status)) return true;
  return node.kind === 'decision' && !isClosed(node.status);
}

/**
 * Why the Send button will not take a blocked step. #634.
 *
 * There are two kinds of block and, until #564 recorded which one a row
 * carries, there was one sentence for both: every refusal said the step was
 * waiting on something outside the repo. That is the wrong thing to tell
 * somebody about a step whose block names three other steps, none of which
 * have closed. The kind is on the row now, so a block on steps names the ones
 * still open instead, because that list is what the press was really about.
 *
 * What this does not change is whether the press is refused. #525 settled that
 * the two kinds are recorded, not what the Send button does with each, so a
 * block on steps is refused here exactly as it was.
 *
 * A block with no kind recorded, or one this build does not recognise, reads
 * as `outside` and keeps the sentence it had -- the same reading `isStaleBlock`
 * and `isReady` take of it.
 */
export function blockRefusal(
  node: Pick<PlanNode, 'number'> & {
    dependsOn?: readonly PlanLink[];
    blockKind?: PlanBlockKind | null;
  },
): string {
  if (!waitsOnItsSteps(node)) {
    return (
      `#${node.number} is blocked on something outside the repo. ` +
      'Clear what it is waiting on first -- its note says what.'
    );
  }

  // Blocked on steps and naming none. `isStaleBlock` leaves such a row blocked
  // on purpose, since there is nothing on record for the block to have
  // outlived, so the press is refused with nothing to point at. Saying that is
  // more use than an empty list.
  const open = (node.dependsOn ?? []).filter((link) => !isClosed(link.item.status));
  if (open.length === 0) {
    return (
      `#${node.number} is blocked on other steps, and none are recorded against it. ` +
      'Say what it is waiting for, or put it back to not started.'
    );
  }

  const named = andList(open.map((link) => `#${link.item.number}`));
  return open.length === 1
    ? `#${node.number} is blocked on ${named}, which is still open. ` +
        'It clears itself when that step closes.'
    : `#${node.number} is blocked on ${named}, which are still open. ` +
        'It clears itself when they close.';
}

/** "#1", then "#1 and #2", then "#1, #2 and #3". */
function andList(parts: readonly string[]): string {
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The feature a step belongs to: the highest step above it, or itself.
 *
 * The whole tree it sits in, rather than the nearest ancestor that says what
 * finishing means -- lib/plan/brief.ts wants that narrower one for a
 * destination, and this one is for the rules that hold over a batch: one
 * session per feature, and a re-shape that re-reads everything under the top
 * of the tree.
 */
export function topFeatureOf(sections: readonly PlanSection[], node: PlanNode): PlanNode {
  const ancestors = ancestorsOf(sections, node.id);
  return ancestors[0] ?? node;
}

export function summarize(sections: readonly PlanSection[]): PlanSummary {
  const all = flattenSections(sections);
  // Every count on the strip is over the rows still being asked about. A
  // dismissed one is in exactly one of them, the one that says how many there
  // are to find.
  const nodes = all.filter((node) => !isDismissed(node));
  // Everything still outstanding, proposals included -- what the Open view
  // lists. The counts below it are about the decided work, so they keep the
  // narrower set: a proposal is not "ready", not "underway" and not Claude's.
  const outstanding = nodes.filter((node) => !isClosed(node.status));
  const open = outstanding.filter((node) => node.status !== 'proposed');
  return {
    total: nodes.length,
    open: outstanding.length,
    onYou: outstanding.filter((node) => needsThePerson(node)).length,
    proposed: nodes.filter((node) => node.status === 'proposed').length,
    inProgress: open.filter((node) => node.status === 'in_progress').length,
    waiting: open.filter((node) => isBlocked(node) || node.waitingOn.length > 0).length,
    ready: open.filter((node) => node.ready).length,
    done: nodes.filter((node) => node.status === 'done').length,
    claude: open.filter((node) => isClaudes(node) && !isWaitingOnThePerson(node)).length,
    fog: nodes.filter((node) => hasLiveFog(node)).length,
    dismissed: all.filter((node) => isDismissed(node) || node.fogDismissedAt !== null).length,
  };
}
