'use client';

import {
  Fragment,
  useActionState,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { ChevronDown, HelpCircle, Wrench } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { LinkedText } from '@/components/ui/linked-text';
import { CommentCount } from '@/components/dev/comment-count';
import { Thread } from '@/components/thread/thread';
import { threadRef } from '@/lib/thread/subjects';
import { FogNote } from '@/components/dev/fog-note';
import { StateLabel, TONE_TEXT, type DevTone } from '@/components/dev/state-label';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { planRowId, type PlanRefTitles } from '@/lib/comments/refs';
import { isClosed, isDismissed } from '@/lib/plan/load';
import { sessionOrigin, type SessionOrigin } from '@/lib/plan/origin';
import type { PlanProgress } from '@/lib/plan/tree';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';
import { cn } from '@/lib/cn';
import { Breakdown } from './counts';
import { Dependencies } from './dependencies';
import { LEVEL, ROW_GRID, TreeGuides } from './grid';
import { Questions } from './questions';
import {
  PLAN_COMMENTS,
  type TreeActionState,
  type TreeActions,
  type TreeCatalogEntry,
  type TreeComments,
  type TreeDependencyNode,
  type TreeQuestion,
} from './types';
import { DashCredit } from '@/components/ui/dash-mark';

/**
 * One row of a plan-shaped tree, and the panel behind it (plan #996).
 *
 * The dev plan's row, with everything that is only the plan's -- sending to
 * a session, the run behind a claim, commit checks, priority and size --
 * passed in by the page rather than written here. What is left is what any
 * page of steps shares: the tree guides and the fold, the number and title,
 * the health word you press to change, whose move it is, the count of what
 * is beneath, the fog, and the opened panel with the detail, Done when,
 * Needs, the note, the questions, what it waits on and the thread.
 *
 * A page fills it in three steps: `useTreeRow` for the row's own state, which
 * the page's menus need; its own health, move and menus, worked out from that
 * state; then `TreeRow` with those and any slots it uses. `body` is the slot
 * for what only that page has, drawn in the panel under the note.
 */

/** A step as the shared row reads it. The dev plan's `PlanNode` fits as it is. */
export type TreeRowNode = TreeQuestion &
  TreeDependencyNode & {
    module: string | null;
    acceptance: string | null;
    /** What a blocked step needs, in one sentence. */
    blockAsk: string | null;
    /** The step's history note. */
    comment: string | null;
    fog: string | null;
    fogDismissedAt: string | null;
    /** Under a filter: whether this row matched or is only here for what is beneath it. */
    matches: boolean;
    rollup: PlanProgress;
    children: readonly TreeRowNode[];
  };

/** A health word as the row draws it: see `healthOf` in lib/plan/health-words.ts. */
export type TreeHealth = {
  word: string;
  tone: DevTone;
  title?: string;
  glyph: GlyphName;
  name: string;
};

/**
 * The row's own state, held by the page's row so its menus can open the panel,
 * the edit form or the add form.
 */
export function useTreeRow(
  node: TreeRowNode,
  {
    searching,
    unfolded,
    opened = false,
    showDismissed = false,
  }: {
    /** Whether a search is narrowing the page. Unfolds closed rows that hold a hit. */
    searching: boolean;
    /** Start with the sub-steps showing. A seam for the render tests and the gallery. */
    unfolded: boolean;
    /** Start with the row's own panel open. The same kind of seam. */
    opened?: boolean;
    /** Whether the page is showing what has been put aside. */
    showDismissed?: boolean;
  },
) {
  // A question lives in its step's panel rather than as a row of its own, so
  // the Dismissed view would otherwise be a list of steps to open one at a
  // time. The rows that hold something put aside start open there.
  const [open, setOpen] = useState(
    opened ||
      (showDismissed &&
        node.children.some((child) => child.kind === 'decision' && isDismissed(child))),
  );
  const [editing, setEditing] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [answering, setAnswering] = useState(false);
  const substeps = node.children.filter((child) => child.kind !== 'decision');
  const hasChildren = substeps.length > 0;
  // Every feature starts folded.
  //
  // It used to be only the closed ones, on the grounds that finished work is
  // consulted rather than read. But the page opens on a plan of 117 features
  // and several hundred steps, and unfolding all the open ones by default made
  // the first screen a wall with no shape in it -- the modules and the features
  // are the map, and you cannot see a map through its own detail. The arrow on
  // every row is one press, and it was already there.
  //
  // A search is the exception, and the same one as before: the row is only on
  // the page because something inside it matched, and folding that away would
  // be answering the search with a closed drawer.
  //
  // Fog folds too, and that is the whole of what the arrow is for on a row
  // with no steps under it. #386 is fog and nothing else -- a feature real
  // enough to name and not yet real enough to break up -- so gating the arrow
  // on sub-steps alone left its one block of text pinned open with no control
  // anywhere on the row. A leaf still starts unfolded, so scanning the plan
  // shows the fog exactly as it did; what is new is being able to put it away.
  const foldableFog = Boolean(node.fog) && (node.fogDismissedAt === null || showDismissed);
  const [showChildren, setShowChildren] = useState(
    () => searching || unfolded || (!hasChildren && foldableFog),
  );

  return {
    open,
    setOpen,
    editing,
    setEditing,
    addingChild,
    setAddingChild,
    answering,
    setAnswering,
    showChildren,
    setShowChildren,
    substeps,
    hasChildren,
    foldableFog,
    /** Show the sub-steps and open the add form beneath them. */
    addChild: () => {
      setShowChildren(true);
      setAddingChild(true);
    },
  };
}

export type TreeRowState = ReturnType<typeof useTreeRow>;

/** Everything under a row sits in from the tree by the same amount the title does. */
export function rowInset(trail: readonly boolean[]): CSSProperties {
  return { paddingLeft: `${0.75 + trail.length * 1.25 + 1.25}rem` };
}

export function TreeRow<E extends TreeCatalogEntry>({
  node,
  trail,
  row,
  health,
  move,
  statusMenu,
  menu,
  actions,
  anchorId,
  origin = null,
  addedBy = null,
  source,
  need = null,
  marks,
  priority,
  quickActions,
  notices,
  edit,
  titleEditor,
  detailView,
  acceptanceView,
  body,
  meta,
  panelActions,
  addChild,
  dependencies,
  comments = PLAN_COMMENTS,
  titles,
  threadPlaceholder = 'A note on this step. Tag @dash to ask something, or to tell it to reword the step, file an idea or build it.',
  renderChild,
  layout = 'grid',
  after,
  heading = false,
  titleHref,
}: {
  /**
   * Where the title goes, when the row has a page of its own (a goal step's,
   * plan #1621). The title is then a link to it, and the chevron in the fold
   * slot opens the panel in place, on a leaf as well. The dev plan passes
   * none, so its titles stay the fold.
   */
  titleHref?: string;
  /**
   * The row is what its page is about (a goal step's own page, plan #1620):
   * the title is the page's heading rather than a fold, since the page is the
   * step opened, and the status control and menu stay beside it.
   */
  heading?: boolean;
  /**
   * `grid` is the dev plan's row: the shared columns under a header, with the
   * outline number, health word, move, priority and count of what is beneath.
   * `list` is a goal's row (plan #1078): the status control before the title
   * as a glyph, the title with its marks, the `priority` cell at the end
   * (under the title on a phone), and the menu. The panel is the same.
   */
  layout?: 'grid' | 'list';
  /** Drawn under the sub-steps while they show: on a goal, the fold of the finished ones. */
  after?: ReactNode;
  node: TreeRowNode;
  /** One entry per level above: whether that level's line carries on below this row. */
  trail: readonly boolean[];
  row: TreeRowState;
  health: TreeHealth;
  /**
   * The cell beside health: on the plan, whose move it is, drawn with
   * `MoveLabel` (components/ui/move-label.tsx); on a goal, who the step is on.
   */
  move: React.ReactNode;
  /** What pressing the health word offers. */
  statusMenu: ActionMenuItem[];
  /** The row's own menu, at the end of the line. */
  menu: ActionMenuItem[];
  actions: TreeActions;
  /** The row's anchor. The dev plan's, which a `#494` in a comment lands on, by default. */
  anchorId?: string;
  /** The answer that produced this row, when a re-shape wrote it. */
  origin?: { number: number; gist: string } | null;
  /**
   * Which session wrote this row ready to build, when one did: the day, and
   * the session's id for the hover text. The dev plan's, for a step added
   * under a feature you had already approved.
   */
  addedBy?: SessionOrigin | null;
  /** Where the step lives when the page shows it away from home: a line under the title, in text only. */
  source?: string;
  /**
   * What the step is waiting on you for, said on the row in place of its note
   * while it is closed. The ask is otherwise behind the fold or in a tooltip,
   * and a row that says "Waiting on you" without saying for what sends you
   * opening it to find out.
   */
  need?: string | null;
  /** Marks after the title and the comment count. */
  marks?: ReactNode;
  /** The priority column, from sm up. Empty when not given. */
  priority?: ReactNode;
  /** The quick icons shown under the pointer, before the menu. */
  quickActions?: ReactNode;
  /** List items drawn straight under the row: a confirmation, what an action said. */
  notices?: ReactNode;
  /** The edit form, drawn in place of the panel while the row is being edited. */
  edit?: ReactNode;
  /**
   * The title's own editor, drawn where the title is while the row is being
   * edited, for a page whose step is edited in place rather than in a form
   * (plan #1435). With it, Edit renames the row and the panel stays open.
   */
  titleEditor?: ReactNode;
  /** The detail as the page draws it, in place of the plain text: an editor at rest, say. */
  detailView?: ReactNode;
  /** The done-when as the page draws it, under the Done when heading, even when empty. */
  acceptanceView?: ReactNode;
  /** The page's own content in the opened panel, under the note. */
  body?: ReactNode;
  /** The line of facts near the foot of the opened panel. */
  meta?: ReactNode;
  /** Buttons after Edit and Add a sub-step in the opened panel. */
  panelActions?: ReactNode;
  /** The add form, drawn under the sub-steps while one is being added. */
  addChild?: ReactNode;
  /** What the dependency picker offers. No dependencies section when left out. */
  dependencies?: { catalog: readonly E[]; groupOf: (entry: E) => string };
  comments?: TreeComments;
  /** What each step number in a comment is called, for the hover text. */
  titles?: PlanRefTitles;
  /** What the empty comment box says. The dev plan's, naming what Dash can do there, by default. */
  threadPlaceholder?: string;
  /** Draws one sub-step, one level further in. */
  renderChild: (child: TreeRowNode, trail: readonly boolean[]) => ReactNode;
}) {
  const [fogState, fogAction, fogPending] = useActionState(
    actions.dismissFog,
    {} as TreeActionState,
  );
  const { open, setOpen, showChildren, setShowChildren, substeps, hasChildren, foldableFog } = row;

  // A question beneath a step is that step's question, and it is read and
  // answered in the step's own questions section. It is deliberately not also a
  // row in the tree: the same question in two places, one of which can answer
  // it, is how you end up answering neither. A decision at the top of a module
  // is nobody's question but its own and stays a row.
  const questions = node.children.filter((child) => child.kind === 'decision');
  const unanswered = questions.filter((question) => !isClosed(question.status)).length;

  const closed = isClosed(node.status);
  const isDecision = node.kind === 'decision';
  // What the open button calls the row. A plan step's number is its handle,
  // the one the commits and comments use, so the button says it. A page that
  // anchors its rows by its own id has no such number: a goal step's is only
  // its place in reading order, which the page shows nowhere, so the button
  // says the outline the row reads ("12.1").
  const handle = anchorId ? node.outline : node.number;
  // A setup job still open. Closed, it is an ordinary finished row -- the
  // errand is run, and a box inviting you to run it again would be a lie.
  const setupOpen = node.kind === 'setup' && !closed;

  // The line under the title: what it involves, or failing that your note --
  // minus the stamps, which have their own lines above and should not be said
  // twice on one row. The session stamp is left out whether or not it is
  // shown: on a closed step it is history, and "Note: Added by session cse_…"
  // is not what the step was about.
  const gloss =
    (node.detail ?? node.comment ?? '')
      .split('\n')
      .find(
        (line) =>
          line.trim() &&
          !(origin && line.includes(`#${origin.number}'s answer:`)) &&
          !sessionOrigin(line),
      ) ?? '';

  const inset = rowInset(trail);

  // One fold for the whole row (note b6d9e10b). The arrow and the title used
  // to open two different things -- the sub-steps, and the step's own panel --
  // and a step read in full meant pressing both. Either now unfolds both, or
  // folds everything when anything is showing; the arrow at the top of the
  // panel condenses the panel and leaves the sub-steps.
  const foldable = hasChildren || foldableFog;
  const expanded = open || (foldable && showChildren);
  // A leaf has nothing to fold, so its chevron (drawn when the title links
  // away) opens and closes the panel, and says so.
  const foldLabel = foldable
    ? `${expanded ? 'Fold' : 'Unfold'} #${handle}`
    : `${expanded ? 'Close' : 'Open'} #${handle}`;
  const titleClass = cn(
    'min-w-0',
    open ? 'break-words' : 'break-words sm:truncate',
    node.status === 'dropped' && 'text-ink-muted line-through',
  );
  const toggle = () => {
    const next = !expanded;
    setOpen(next);
    if (foldable) setShowChildren(next);
  };

  // A feature's panel sits above its sub-steps, and opening the row showed
  // both in full: the detail pushed the steps a screen down. So on a row with
  // sub-steps showing, the panel starts condensed to one arrow at its top that
  // says Show details (note c588f394). A leaf has nothing else to show, and
  // opens straight to its panel. A row that starts open, or is opened by a
  // link to it, shows its details, since that is what was asked for.
  const [detailsShown, setDetailsShown] = useState(open);
  // On the step's own page the details are what the page is for, so they
  // do not fold.
  const condensable = hasChildren && showChildren && !heading;
  // The first line of the detail, or of the done-when, without markdown's
  // link brackets: what a folded panel shows beside Show details.
  const foldedPreview = (node.detail ?? node.acceptance ?? '')
    .split('\n')
    .map((line) => line.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_#>`]/g, '').trim())
    .find((line) => line.length > 0);

  // A link to this row by its own id (a goal step from the Goals home, or
  // from Go to the step under a finding) opens its panel as well as scrolling
  // to it. Landing on a closed row that looks the same as before read as the
  // link doing nothing.
  useEffect(() => {
    if (!anchorId) return;
    const openIfNamed = () => {
      if (window.location.hash === `#${anchorId}`) {
        setOpen(true);
        setDetailsShown(true);
      }
    };
    openIfNamed();
    window.addEventListener('hashchange', openIfNamed);
    return () => window.removeEventListener('hashchange', openIfNamed);
  }, [anchorId, setOpen]);

  const list = layout === 'list';
  // Health is a word you click to change, not a badge you have to open the
  // step to change: "where is this" is the question the page exists for, and
  // answering it differently should not be a form. The grid draws it after
  // the title; the list draws it before, where a checkbox would be.
  const healthMenu = (
    <ActionMenu
      label={`Status of #${node.outline} ${node.title}`}
      items={statusMenu}
      align="start"
      className={list ? 'shrink-0' : 'justify-self-start'}
      triggerClassName={cn(
        list
          ? 'size-7 px-0 text-small font-medium'
          : 'h-7 w-auto gap-1.5 px-1.5 text-small font-medium',
        TONE_TEXT[health.tone],
      )}
      trigger={
        <StateLabel
          // Inherits the trigger's own text size and tone, which is what
          // makes the health a word you click rather than a badge inside a
          // button.
          className="text-inherit"
          tone={health.tone}
          title={health.title}
          word={health.word}
          // No glyph on a dropped row. The slash was a third way of
          // saying what the ghost tone and the struck-through title
          // already say, on the one state nobody is scanning for -- so it
          // read as clutter beside the rows that are still live, which is
          // where the eye is actually going (law 15). Every other state
          // keeps its shape: those are the ones being scanned, and the
          // glyph is how they are told apart at a glance. The count
          // beside the module heading keeps its slash too, because there
          // a bare number would say nothing at all.
          glyph={health.name === 'dropped' && !list ? null : health.glyph}
          // On a phone the glyph stands for the word, which stays for
          // screen readers, so a dropped row gets its slash back there.
          // In the list layout the glyph is the control at every width,
          // and the word is its accessible name and tooltip.
          wordClassName={list ? 'sr-only' : 'max-sm:sr-only'}
        >
          {health.name === 'dropped' && !list && (
            <StatusGlyph glyph={health.glyph} className="sm:hidden" />
          )}
        </StateLabel>
      }
    />
  );

  // What the title cell says: the title and the lines under it. A button
  // that folds the row, or, where the title links to the step's own page, a
  // plain cell beside the chevron that folds it.
  const rowLines = (
    <>
      <span
        className={cn(
          'flex min-w-0 items-baseline gap-1.5 text-ui',
          trail.length === 0 ? 'font-medium text-ink' : 'text-ink',
        )}
      >
        {/* Where the row sits, not just what it is called: a feature
              reads #595 and its second step reads #595.2, so a step says
              which feature it belongs to and how far through it is
              without the tree guides having to be traced up by eye.
              `number` is still the handle -- it is what the commits, the
              comments and the CLI say, it is the anchor a `#597` link
              lands on, and the button around this says "Open #597" -- and
              the search box takes either. */}
        {!list && (
          <span className="tabular shrink-0 text-small text-ink-ghost">#{node.outline}</span>
        )}
        {/* Truncated closed, whole open. A row is a line and a long title
         * has to give way to keep it one; but opening the step is the
         * gesture that means "show me this one", and a name still cut
         * off after it leaves no way to read it at all. On a phone it
         * wraps closed as well: the name cell there is what is left
         * after the health and the menu, which cut titles to two words
         * (plan #1041). */}
        {titleHref ? (
          <Link
            href={titleHref}
            className={cn(
              titleClass,
              'press-area underline-offset-2 hover:text-accent hover:underline',
            )}
          >
            {node.title}
          </Link>
        ) : (
          <span className={titleClass}>{node.title}</span>
        )}
        {/* A question waiting on this step, said on the row. The section
         * that answers it is behind the fold, and a question nobody
         * knows is there is the thing this whole section exists to
         * stop. */}
        {unanswered > 0 && !open && (
          <span
            title={`${unanswered} unanswered ${unanswered === 1 ? 'question' : 'questions'}`}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-caution-tint px-1.5 text-small font-semibold text-caution"
          >
            <HelpCircle className="size-3" strokeWidth={2} aria-hidden />
            {unanswered}
            <span className="sr-only">
              unanswered {unanswered === 1 ? 'question' : 'questions'}
            </span>
          </span>
        )}
        {/* And whether anything has been said about it. */}
        <CommentCount count={node.thread.length} />
        {marks}
      </span>
      {/* Where it came from, when it did not come from you. On the row
            and not behind the fold, because a step that appeared under a
            feature you approved last week is exactly the one you would
            never think to open. */}
      {origin && (
        <span className="block truncate text-small text-ink-ghost">
          From #{origin.number}&apos;s answer: {origin.gist}
        </span>
      )}
      {/* The same, for a step a session wrote ready to build. Approval
            stops at the feature, so this row never asked you; saying so
            is what the Drop at the top of its menu is for. */}
      {addedBy && (
        <span
          title={addedBy.session ? `Session ${addedBy.session}` : undefined}
          className="block truncate text-small text-ink-ghost"
        >
          <DashCredit />
          Added by Dash on {addedBy.date}
        </span>
      )}
      {source && <span className="block truncate text-small text-ink-ghost">{source}</span>}
      {need && !open && (
        <span className="block truncate text-small text-ink">
          <span className="font-medium text-caution">Needs: </span>
          {need}
        </span>
      )}
      {gloss && !open && !need && (
        <span className="block truncate text-small text-ink-muted">
          {!node.detail && 'Note: '}
          {gloss}
        </span>
      )}
      {/* On a phone the list layout's last cell goes under the title. */}
      {list && priority && (
        <span className="block text-small text-ink-muted sm:hidden">{priority}</span>
      )}
    </>
  );

  return (
    <>
      {/* The anchor a `#494` written in a comment lands on. `scroll-mt` keeps
          the row clear of the pinned header it would otherwise arrive under. */}
      <li
        id={anchorId ?? planRowId(node.number)}
        className={cn(
          list ? 'flex items-start gap-x-1' : ROW_GRID,
          'group scroll-mt-24 px-3',
          (gloss || need) && !open ? 'py-1.5' : 'py-2',
          !node.matches && 'opacity-60',
          // A goal's finished rows sit under their own Finished fold, which
          // says they are finished; dimmed as well, their muted text fell
          // under the contrast floor.
          // Opened, a finished step is being read, as its title already is
          // in full: dimmed, its #number fell to 2.3:1 (plan #1541).
          closed && !list && !open && 'opacity-70',
        )}
      >
        <div className={cn('flex min-w-0 items-stretch', list && 'flex-1')}>
          <TreeGuides trail={trail} />

          {/* The fold, where there is something beneath to fold. A spacer
              where there is not, so the titles at one depth line up. */}
          {heading ? null : foldable || (titleHref && !isDecision && !setupOpen) ? (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={expanded}
              title={foldLabel}
              aria-label={foldLabel}
              className={cn(
                LEVEL,
                'press flex shrink-0 items-center justify-center rounded text-ink-muted hover:bg-accent-tint hover:text-accent',
                // In the list the row can run to several lines (the title,
                // Needs, a date), so the fold sits on the title's line.
                list ? 'mt-1 h-5 self-start' : 'h-5 self-center',
              )}
            >
              <ChevronDown
                className={cn(
                  'size-3.5 transition-transform duration-quick',
                  !expanded && '-rotate-90',
                )}
                strokeWidth={1.75}
                aria-hidden
              />
            </button>
          ) : isDecision ? (
            // Where a build step's checkbox would be. A question and a piece
            // of work are different things, and the row should say which it is
            // before the health column is read.
            <span
              title="A decision: a question, closed by an answer rather than a commit."
              className={cn(
                LEVEL,
                'flex h-5 shrink-0 select-none items-center justify-center self-center text-small font-semibold text-caution',
              )}
            >
              ?<span className="sr-only">Decision</span>
            </span>
          ) : setupOpen ? (
            // The same slot, for the other row that is not a piece of work.
            // A setup job is an errand, closed by going and doing it, and the
            // row should say so before the health column is read -- the same
            // argument as the question mark above.
            <span
              title="A setup job: something only you can set up, closed when you have."
              className={cn(
                LEVEL,
                'flex h-5 shrink-0 select-none items-center justify-center self-center text-caution',
              )}
            >
              <Wrench className="size-3.5" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">Setup</span>
            </span>
          ) : (
            <span className={cn(LEVEL, 'shrink-0')} aria-hidden />
          )}

          {list && healthMenu}

          {/* The title and the chevron beside it are one fold: either opens
              the step's panel and its sub-steps together. Renamed in place
              where the page gives the title an editor. */}
          {row.editing && titleEditor ? (
            <div className="min-w-0 flex-1 self-center">{titleEditor}</div>
          ) : heading ? (
            <h1 className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1 self-center pl-1 font-display text-title tracking-tight text-ink [overflow-wrap:anywhere]">
              <span className={cn(node.status === 'dropped' && 'text-ink-muted line-through')}>
                {node.title}
              </span>
              <span className="inline-flex items-center gap-1.5 font-sans text-ui font-normal tracking-normal">
                <CommentCount count={node.thread.length} />
                {marks}
              </span>
            </h1>
          ) : titleHref ? (
            <div
              className={cn(
                'min-w-0 flex-1 text-left',
                list ? 'self-start py-1 pl-1' : 'self-center',
              )}
            >
              {rowLines}
            </div>
          ) : (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={expanded}
              title={expanded ? `Close #${handle}` : `Open #${handle}`}
              className={cn(
                'min-w-0 flex-1 text-left hover:text-accent',
                list ? 'self-start py-1 pl-1' : 'self-center',
              )}
            >
              {rowLines}
            </button>
          )}
        </div>

        {!list && healthMenu}

        {/* Whose move it is, beside how far along it is.

            A word and a tone, and deliberately no hexagon: the hexagons belong
            to health, they are a scale from empty to full, and a second column
            of them beside it would read as a second position on the same scale
            rather than as an answer to a different question. The one shape is
            Dash's working mark, which MoveLabel puts beside "Dash is on it".

            Not a menu, where health is one. Health is set by hand; this is
            derived from what is already true of the row -- who it is assigned
            to, what it waits on, whether it is a question -- so there is
            nothing here to pick. Changing it means handing the step over or
            answering what it asks, which are the buttons already on the row. */}
        {list ? (
          priority &&
          !heading && (
            <span className="hidden max-w-48 shrink-0 pt-1.5 text-right text-small sm:block">
              {priority}
            </span>
          )
        ) : (
          <>
            <span className="hidden min-w-0 truncate text-small sm:block">{move}</span>

            <span className="hidden truncate text-small sm:block">{priority}</span>

            {/* No "Who" column. It was a column of dashes with the occasional
                name in it -- one fact, on a plan whose every approved step the
                runner takes unless you keep it, and keeping it is a button. */}
            <span className="hidden sm:block">
              <Breakdown rollup={node.rollup} />
            </span>
          </>
        )}

        {/* The things done to a step without reading it first, then the menu
            for everything else. Under the pointer or under focus, so a plan at
            rest is a plan rather than a wall of icons; the same actions are in
            the menu, which is how a phone reaches them. */}
        <div className={cn('flex items-center justify-self-end', list && 'shrink-0')}>
          {quickActions && (
            <div className="hidden items-center opacity-0 transition-opacity duration-quick group-focus-within:opacity-100 group-hover:opacity-100 sm:flex">
              {quickActions}
            </div>
          )}
          <ActionMenu label={`Actions for #${node.outline}`} items={menu} />
        </div>
      </li>

      {notices}

      {/* In the tree rather than behind the fold, because fog on a feature is
          the thing you most want to see while scanning a plan: it is the part
          that is admittedly not a plan yet, and one that only showed on a step
          you thought to open would be a gap nobody found. Quiet and dashed, so
          it does not read as detail. Nothing at all when there is none, which
          is most steps most of the time.

          It does fold with the group, though. Fog belongs to what is beneath
          the row -- it is the part of it that is not a plan yet -- so a
          collapsed feature leaving its fog behind was one block outliving the
          thing it described. The arrow appears for fog as well as for
          sub-steps, so the fold is a control everywhere it is a state. */}
      {foldableFog && showChildren && (
        <li style={inset} className="pb-1.5 pr-3">
          {/* Putting the patch aside stops it being raised: off the page,
              out of the Not specified view, out of every turn, and no
              longer holding the step open when you close it. */}
          <FogNote
            id={node.id}
            fog={node.fog ?? ''}
            aside={node.fogDismissedAt !== null}
            action={fogAction}
            pending={fogPending}
            error={fogState.error}
          />
        </li>
      )}

      {row.editing && !titleEditor ? (
        <li style={inset} className="pr-3">
          {edit}
        </li>
      ) : (
        open && (
          // The step itself, as a panel with an edge of its own. It was loose
          // rows at the next indent, which made opening a step look like
          // unfolding one more level of the tree -- the same gesture and the
          // same shape for two different meanings.
          // On the step's own page the panel is the page, so it has no edge of
          // its own and lines up with the heading (plan #1620).
          <li style={heading ? { paddingLeft: '0.75rem' } : inset} className="pb-3 pr-3">
            <div
              className={cn(
                'space-y-3',
                heading ? 'py-1' : 'border-l-2 border-accent bg-canvas px-3 py-2.5',
              )}
            >
              {condensable && (
                <button
                  type="button"
                  onClick={() => setDetailsShown(!detailsShown)}
                  aria-expanded={detailsShown}
                  className="press -mx-1 flex w-full min-w-0 items-center gap-1 rounded px-1 text-small font-semibold text-ink-muted hover:bg-accent-tint hover:text-accent"
                >
                  <ChevronDown
                    className={cn(
                      'size-3.5 transition-transform duration-quick',
                      !detailsShown && '-rotate-90',
                    )}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  {detailsShown ? 'Hide details' : 'Show details'}
                  {/* Folded, the line carries the first of what the details
                  say, so the space is worth having (note 886d6e4f). */}
                  {!detailsShown && foldedPreview && (
                    <span className="min-w-0 flex-1 truncate text-left font-normal text-ink-muted">
                      {foldedPreview}
                    </span>
                  )}
                </button>
              )}
              {(!condensable || detailsShown) && (
                <>
                  {/* Not on a decision: there the detail is the options, and it is
                  shown as options inside the question block rather than twice.
                  Nor on an open setup job, where the detail is the
                  instructions and is drawn inside the box that closes them. */}
                  {!isDecision && !setupOpen && detailView}
                  {node.detail && !isDecision && !setupOpen && !detailView && (
                    <p className="whitespace-pre-wrap text-ui text-ink-muted">
                      <LinkedText text={node.detail} />
                    </p>
                  )}
                  {(node.acceptance || acceptanceView) && (
                    <div>
                      <p className="text-small font-semibold uppercase tracking-wide text-ink-muted">
                        Done when
                      </p>
                      {acceptanceView ?? (
                        <p className="whitespace-pre-wrap text-ui text-ink">
                          <LinkedText text={node.acceptance ?? ''} />
                        </p>
                      )}
                    </div>
                  )}
                  {/* What it needs, in its own line above the history. The comment
                  below is every block this step has had, dated; this is the one
                  sentence that still stands. */}
                  {node.blockAsk && (
                    <div>
                      <p className="text-small font-semibold uppercase tracking-wide text-ink-muted">
                        Needs
                      </p>
                      <p className="whitespace-pre-wrap text-ui text-ink">
                        <LinkedText text={node.blockAsk} />
                      </p>
                    </div>
                  )}
                  {node.comment && (
                    <p className="whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-ui text-ink">
                      <LinkedText text={node.comment} />
                    </p>
                  )}

                  {body}

                  <Questions node={node} titles={titles} actions={actions} comments={comments} />

                  {dependencies && (
                    <Dependencies
                      node={node}
                      catalog={dependencies.catalog}
                      groupOf={dependencies.groupOf}
                      actions={actions}
                      closed={closed}
                    />
                  )}

                  <Thread
                    subject={threadRef(comments.target, node.id)}
                    turns={node.thread}
                    titles={titles}
                    placeholder={threadPlaceholder}
                  />

                  {meta}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      // On the step's own page its words line up with the text above.
                      className={heading ? '-ml-2.5' : undefined}
                      onClick={() => row.setEditing(true)}
                    >
                      {titleEditor ? 'Rename' : 'Edit'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={row.addChild}>
                      Add a sub-step
                    </Button>
                    {panelActions}
                  </div>
                </>
              )}
            </div>
          </li>
        )
      )}

      {hasChildren &&
        showChildren &&
        substeps.map((child, index) => (
          <Fragment key={child.id}>
            {renderChild(child, [...trail, index < substeps.length - 1])}
          </Fragment>
        ))}

      {showChildren && after}

      {row.addingChild && addChild && (
        <li style={inset} className="py-2 pr-3">
          {addChild}
        </li>
      )}
    </>
  );
}
