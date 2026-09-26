'use client';

import { Fragment, useActionState, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, HelpCircle, Wrench } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { CommentCount } from '@/components/dev/comment-count';
import { CommentThread } from '@/components/dev/comment-thread';
import { FogNote } from '@/components/dev/fog-note';
import { StateLabel, TONE_TEXT, type DevTone } from '@/components/dev/state-label';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { planRowId, type PlanRefTitles } from '@/lib/comments/refs';
import { isClosed, isDismissed } from '@/lib/plan/load';
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

/** Whose move it is: see `moveFor` in lib/plan/health-words.ts. */
export type TreeMove = { word: string; tone: DevTone; title?: string };

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
  source,
  need = null,
  marks,
  priority,
  quickActions,
  notices,
  edit,
  body,
  meta,
  panelActions,
  addChild,
  dependencies,
  comments = PLAN_COMMENTS,
  titles,
  threadPlaceholder = 'A note on this step. Tag @dash to ask something, or to tell it to reword the step, file an idea or build it.',
  renderChild,
}: {
  node: TreeRowNode;
  /** One entry per level above: whether that level's line carries on below this row. */
  trail: readonly boolean[];
  row: TreeRowState;
  health: TreeHealth;
  move: TreeMove;
  /** What pressing the health word offers. */
  statusMenu: ActionMenuItem[];
  /** The row's own menu, at the end of the line. */
  menu: ActionMenuItem[];
  actions: TreeActions;
  /** The row's anchor. The dev plan's, which a `#494` in a comment lands on, by default. */
  anchorId?: string;
  /** The answer that produced this row, when a re-shape wrote it. */
  origin?: { number: number; gist: string } | null;
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
  // minus the stamp, which has its own line above and should not be said
  // twice on one row.
  const gloss =
    (node.detail ?? node.comment ?? '')
      .split('\n')
      .find((line) => line.trim() && !(origin && line.includes(`#${origin.number}'s answer:`))) ??
    '';

  const inset = rowInset(trail);

  return (
    <>
      {/* The anchor a `#494` written in a comment lands on. `scroll-mt` keeps
          the row clear of the pinned header it would otherwise arrive under. */}
      <li
        id={anchorId ?? planRowId(node.number)}
        className={cn(
          ROW_GRID,
          'group scroll-mt-24 px-3',
          (gloss || need) && !open ? 'py-1.5' : 'py-2',
          !node.matches && 'opacity-60',
          closed && 'opacity-70',
        )}
      >
        <div className="flex min-w-0 items-stretch">
          <TreeGuides trail={trail} />

          {/* The fold for the sub-steps. A spacer where there are none, so the
              titles at one depth line up. */}
          {hasChildren || foldableFog ? (
            <button
              type="button"
              onClick={() => setShowChildren((value) => !value)}
              aria-expanded={showChildren}
              title={
                hasChildren
                  ? showChildren
                    ? `Fold the ${substeps.length} sub-steps`
                    : `Unfold the ${substeps.length} sub-steps`
                  : showChildren
                    ? 'Fold what is not yet specified'
                    : 'Unfold what is not yet specified'
              }
              aria-label={
                hasChildren
                  ? showChildren
                    ? 'Hide the sub-steps'
                    : 'Show the sub-steps'
                  : showChildren
                    ? 'Hide what is not yet specified'
                    : 'Show what is not yet specified'
              }
              className={cn(
                LEVEL,
                'press flex shrink-0 items-center justify-center self-center rounded text-ink-muted hover:bg-accent-tint hover:text-accent',
                'h-5',
              )}
            >
              <ChevronDown
                className={cn(
                  'size-3.5 transition-transform duration-150',
                  !showChildren && '-rotate-90',
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

          {/* The title opens the step itself, which the chevron beside it
              never does -- that one is the tree, and only the tree. The two
              were told apart by nothing but position, so this one says what it
              is, and what it opens is a panel rather than another level. */}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            title={open ? `Close #${handle}` : `Open #${handle}`}
            className="min-w-0 flex-1 self-center text-left hover:text-accent"
          >
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
              <span className="tabular shrink-0 text-small text-ink-ghost">#{node.outline}</span>
              {/* Truncated closed, whole open. A row is a line and a long title
               * has to give way to keep it one; but opening the step is the
               * gesture that means "show me this one", and a name still cut
               * off after it leaves no way to read it at all. On a phone it
               * wraps closed as well: the name cell there is what is left
               * after the health and the menu, which cut titles to two words
               * (plan #1041). */}
              <span
                className={cn(
                  'min-w-0',
                  open ? 'break-words' : 'break-words sm:truncate',
                  node.status === 'dropped' && 'text-ink-muted line-through',
                )}
              >
                {node.title}
              </span>
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
            {source && (
              <span className="block truncate text-small text-ink-ghost">{source}</span>
            )}
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
          </button>
        </div>

        {/* Health is a word you click to change, not a badge you have to open
            the step to change: "where is this" is the question the page exists
            for, and answering it differently should not be a form. */}
        <ActionMenu
          label={`Status of #${node.outline} ${node.title}`}
          items={statusMenu}
          align="start"
          className="justify-self-start"
          triggerClassName={cn(
            'h-7 w-auto gap-1.5 px-1.5 text-small font-medium',
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
              glyph={health.name === 'dropped' ? null : health.glyph}
              // On a phone the glyph stands for the word, which stays for
              // screen readers, so a dropped row gets its slash back there.
              wordClassName="max-sm:sr-only"
            >
              {health.name === 'dropped' && (
                <StatusGlyph glyph={health.glyph} className="sm:hidden" />
              )}
            </StateLabel>
          }
        />

        {/* Whose move it is, beside how far along it is.

            A word and a tone, and deliberately no glyph: the hexagons belong to
            health, they are a scale from empty to full, and a second column of
            shapes beside them would read as a second position on the same scale
            rather than as an answer to a different question. Law 4 -- if none
            of the meanings is true, use ink and a shape, and here the shape is
            the column itself.

            Not a menu, where health is one. Health is set by hand; this is
            derived from what is already true of the row -- who it is assigned
            to, what it waits on, whether it is a question -- so there is
            nothing here to pick. Changing it means handing the step over or
            answering what it asks, which are the buttons already on the row. */}
        <span
          className={cn('hidden truncate text-small sm:block', TONE_TEXT[move.tone])}
          title={move.title}
        >
          {move.word}
        </span>

        <span className="hidden truncate text-small sm:block">{priority}</span>

        {/* No "Who" column. It was a column of dashes with the occasional
            name in it -- one fact, on a plan whose every approved step the
            runner takes unless you keep it, and keeping it is a button. */}
        <span className="hidden sm:block">
          <Breakdown rollup={node.rollup} />
        </span>

        {/* The things done to a step without reading it first, then the menu
            for everything else. Under the pointer or under focus, so a plan at
            rest is a plan rather than a wall of icons; the same actions are in
            the menu, which is how a phone reaches them. */}
        <div className="flex items-center justify-self-end">
          {quickActions && (
            <div className="hidden items-center opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 sm:flex">
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

      {row.editing ? (
        <li style={inset} className="pr-3">
          {edit}
        </li>
      ) : (
        open && (
          // The step itself, as a panel with an edge of its own. It was loose
          // rows at the next indent, which made opening a step look like
          // unfolding one more level of the tree -- the same gesture and the
          // same shape for two different meanings.
          <li style={inset} className="pb-3 pr-3">
            <div className="space-y-3 border-l-2 border-accent bg-canvas px-3 py-2.5">
              {/* Not on a decision: there the detail is the options, and it is
                  shown as options inside the question block rather than twice.
                  Nor on an open setup job, where the detail is the
                  instructions and is drawn inside the box that closes them. */}
              {node.detail && !isDecision && !setupOpen && (
                <p className="whitespace-pre-wrap text-ui text-ink-muted">{node.detail}</p>
              )}
              {node.acceptance && (
                <div>
                  <p className="text-small font-semibold uppercase tracking-wide text-ink-muted">
                    Done when
                  </p>
                  <p className="whitespace-pre-wrap text-ui text-ink">{node.acceptance}</p>
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
                  <p className="whitespace-pre-wrap text-ui text-ink">{node.blockAsk}</p>
                </div>
              )}
              {node.comment && (
                <p className="whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-ui text-ink">
                  {node.comment}
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

              <CommentThread
                target={comments.target}
                store={comments.store}
                id={node.id}
                thread={node.thread}
                titles={titles}
                placeholder={threadPlaceholder}
              />

              {meta}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => row.setEditing(true)}
                >
                  Edit
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={row.addChild}>
                  Add a sub-step
                </Button>
                {panelActions}
              </div>
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

      {row.addingChild && addChild && (
        <li style={inset} className="py-2 pr-3">
          {addChild}
        </li>
      )}
    </>
  );
}
