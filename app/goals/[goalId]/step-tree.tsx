'use client';

import { createContext, useActionState, useContext, useId, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, CircleHelp, ListTree, Repeat, Sparkles, User } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ComposeTitle, InlineInput, Input, Select, Textarea } from '@/components/ui/field';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import type { GoalMap } from '@/lib/goals/steps-store';
import {
  RHYTHM_COUNT_MAX,
  RHYTHM_PERIODS,
  STEP_ACCEPTANCE_MAX,
  STEP_DETAIL_MAX,
  STEP_KINDS,
  STEP_KIND_LABELS,
  STEP_STATUS_GLYPHS,
  STEP_STATUS_LABELS,
  STEP_TITLE_MAX,
  countSteps,
  describeRhythm,
  type StepKind,
  type StepNode,
} from '@/lib/goals/steps';
import { awaitsReview } from '@/lib/goals/daily';
import { canShowOnTodo } from '@/lib/goals/todo';
import { progressLine, type RhythmRecord } from '@/lib/goals/rhythms';
import {
  addStep,
  archiveStepAction,
  countRhythmAction,
  editStep,
  linkStepAction,
  moveStepAction,
  setStepOnTodoAction,
  setStepStatusAction,
  unlinkStepAction,
  type StepActionState,
} from './actions';
import {
  answerQuestionAction,
  reviewResultAction,
  type ShapingActionState,
} from './shaping-actions';

/**
 * A goal's full tree (plan #925).
 *
 * Each step is a row: its status as a shape, its title edited in place, and
 * beneath it a line saying whose it is and anything else worth a glance (how
 * often a rhythm runs, when it is due, which other goals it counts towards).
 * A step with sub-steps folds, and the folded row says how many it holds.
 * Everything else a step can have sits in its menu or in the details it
 * opens, so the tree stays readable on a phone at four levels deep.
 */

const initial: StepActionState = {};

const KIND_ICONS: Record<StepKind, typeof User> = {
  mine: User,
  claude: Sparkles,
  decision: CircleHelp,
  rhythm: Repeat,
};

/**
 * Whether the Todo workspace is on, so a step offers Show on Todo only where
 * there is a Todo to show it on. Read once by the page and given to every row.
 */
const TodoOn = createContext(false);

/** Each rhythm step's current period and recent past ones (plan #928). */
const Rhythms = createContext<GoalMap['rhythms']>({});

type Links = GoalMap['linksOf'];
type OtherGoals = GoalMap['otherGoals'];

/** Wrap a row action for the menu, so a refusal is said in a toast rather than lost. */
function useMenuAction() {
  const toast = useToast();
  return (action: (form: FormData) => Promise<StepActionState>) => async (form: FormData) => {
    const result = await action(form);
    if (result.error) toast({ text: result.error });
  };
}

function commitOnBlur(before: string, { required = false }: { required?: boolean } = {}) {
  return (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value.trim();
    if (required && value === '') {
      event.target.value = before;
      return;
    }
    if (value !== before) event.target.form?.requestSubmit();
  };
}

export function StepTree({ map, todoOn }: { map: GoalMap; todoOn: boolean }) {
  const { total, closed } = countSteps(map.steps);
  return (
    <TodoOn.Provider value={todoOn}>
      <Rhythms.Provider value={map.rhythms}>
        <div className="space-y-6">
          <section aria-label="Steps" className="space-y-2">
            {total > 0 && (
              <p className="px-1 text-small text-ink-muted">
                {closed} of {total} {total === 1 ? 'step' : 'steps'} closed
              </p>
            )}
            {map.steps.length === 0 ? (
              <EmptyState
                icon={ListTree}
                title="No steps yet"
                description="Break the goal into the things that have to happen. Any step can hold sub-steps of its own."
              />
            ) : (
              <Card>
                <StepList
                  nodes={map.steps}
                  depth={0}
                  links={map.linksOf}
                  otherGoals={map.otherGoals}
                />
              </Card>
            )}
            <StepComposer parentId={map.goal.id} label="New step" />
          </section>

          {map.linked.length > 0 && (
            <section aria-labelledby="linked-heading" className="space-y-2">
              <h2 id="linked-heading" className="px-1 text-ui font-semibold text-ink">
                Also counts towards this goal
              </h2>
              <Card>
                <ul className="divide-y divide-border">
                  {map.linked.map((entry) => (
                    <li key={entry.linkId}>
                      <p className="px-3 pt-2 text-small text-ink-muted">
                        From{' '}
                        <Link href={`/goals/${entry.fromGoal.id}`} className="underline">
                          {entry.fromGoal.title}
                        </Link>
                      </p>
                      <StepList
                        nodes={[entry.step]}
                        depth={0}
                        links={map.linksOf}
                        otherGoals={map.otherGoals}
                        unlinkId={entry.linkId}
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </div>
      </Rhythms.Provider>
    </TodoOn.Provider>
  );
}

function StepList({
  nodes,
  depth,
  links,
  otherGoals,
  unlinkId,
}: {
  nodes: StepNode[];
  depth: number;
  links: Links;
  otherGoals: OtherGoals;
  /** Set on a step shown here through a link, so its menu can remove the link. */
  unlinkId?: string;
}) {
  return (
    <ul className={cn(depth > 0 && 'ml-4 border-l border-border pl-1')}>
      {nodes.map((node, index) => (
        <StepItem
          key={node.id}
          node={node}
          depth={depth}
          index={index}
          count={nodes.length}
          links={links}
          otherGoals={otherGoals}
          unlinkId={unlinkId}
        />
      ))}
    </ul>
  );
}

function StepItem({
  node,
  depth,
  index,
  count,
  links,
  otherGoals,
  unlinkId,
}: {
  node: StepNode;
  depth: number;
  index: number;
  count: number;
  links: Links;
  otherGoals: OtherGoals;
  unlinkId?: string;
}) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [details, setDetails] = useState(false);
  const [editState, edit, editing] = useActionState(editStep, initial);
  const menuAction = useMenuAction();
  const toast = useToast();
  const childrenId = useId();
  const todoOn = useContext(TodoOn);
  const rhythms = useContext(Rhythms);
  const rhythm: RhythmRecord | undefined = node.kind === 'rhythm' ? rhythms[node.id] : undefined;
  const current = node.status === 'open' ? (rhythm?.current ?? null) : null;

  const closed = node.status === 'done' || node.status === 'dropped';
  const hasChildren = node.children.length > 0;
  const stepLinks = links[node.id] ?? [];
  const KindIcon = KIND_ICONS[node.kind];

  async function archive(form: FormData) {
    const result = await archiveStepAction(form);
    if (result.error) {
      toast({ text: result.error });
      return;
    }
    toast({
      text: `Archived ${node.title}.`,
      undo: async () => {
        const restore = new FormData();
        restore.set('id', node.id);
        restore.set('restore', 'true');
        const back = await archiveStepAction(restore);
        if (back.error) throw new Error(back.error);
      },
    });
  }

  const status = menuAction(setStepStatusAction);
  // Show on Todo is offered on your open steps; taking one off is offered on
  // any step still flagged, so nothing can be stranded on Todo.
  const todoItem: ActionMenuItem[] = !todoOn
    ? []
    : node.onTodo
      ? [
          {
            id: 'todo',
            label: 'Take off Todo',
            formAction: menuAction(setStepOnTodoAction),
            formFields: { id: node.id, on: 'false' },
          },
        ]
      : canShowOnTodo(node)
        ? [
            {
              id: 'todo',
              label: 'Show on Todo',
              formAction: menuAction(setStepOnTodoAction),
              formFields: { id: node.id, on: 'true' },
            },
          ]
        : [];
  const countOne = menuAction(countRhythmAction);
  // Counting is offered on a rhythm with a period open now; the period is
  // named in the form, so a press after the week has turned is refused
  // rather than counted towards the new one.
  const rhythmItems: ActionMenuItem[] = current
    ? [
        {
          id: 'count',
          label: 'Count one',
          formAction: countOne,
          formFields: { id: node.id, startsOn: current.startsOn, by: '1' },
        },
        ...(current.count > 0
          ? [
              {
                id: 'uncount',
                label: 'Take one back',
                formAction: countOne,
                formFields: { id: node.id, startsOn: current.startsOn, by: '-1' },
              },
            ]
          : []),
      ]
    : [];
  const move = menuAction(moveStepAction);
  const items: ActionMenuItem[] = [
    ...rhythmItems,
    closed
      ? {
          id: 'reopen',
          label: 'Reopen',
          formAction: status,
          formFields: { id: node.id, status: 'open' },
        }
      : {
          id: 'done',
          label: 'Mark done',
          formAction: status,
          formFields: { id: node.id, status: 'done' },
        },
    ...todoItem,
    ...(closed
      ? []
      : [
          {
            id: 'drop',
            label: 'Drop',
            formAction: status,
            formFields: { id: node.id, status: 'dropped' },
          },
        ]),
    {
      id: 'sub',
      label: 'Add a sub-step',
      onSelect: () => {
        setAdding(true);
        setOpen(true);
      },
    },
    {
      id: 'details',
      label: details ? 'Hide details' : 'Details',
      onSelect: () => setDetails(!details),
    },
    ...(unlinkId
      ? []
      : [
          {
            id: 'up',
            label: 'Move up',
            disabled: index === 0,
            formAction: move,
            formFields: { id: node.id, direction: 'up' },
          },
          {
            id: 'down',
            label: 'Move down',
            disabled: index === count - 1,
            formAction: move,
            formFields: { id: node.id, direction: 'down' },
          },
        ]),
    ...(unlinkId
      ? [
          {
            id: 'unlink',
            label: 'Stop counting towards this goal',
            formAction: menuAction(unlinkStepAction),
            formFields: { linkId: unlinkId },
          },
        ]
      : []),
    {
      id: 'archive',
      label: 'Archive step',
      destructive: true,
      formAction: archive,
      formFields: { id: node.id },
      confirm: hasChildren
        ? `Archive ${node.title} and the ${countSteps(node.children).total} under it?`
        : undefined,
    },
  ];

  const meta = [
    node.kind === 'rhythm' && node.rhythmCount && node.rhythmPeriod
      ? describeRhythm(node.rhythmCount, node.rhythmPeriod)
      : null,
    current && node.rhythmPeriod ? progressLine(node.rhythmPeriod, current) : null,
    node.dueOn ? `Due ${formatDate(node.dueOn)}` : null,
    todoOn && node.onTodo && canShowOnTodo(node) ? 'On Todo' : null,
    !open && hasChildren ? `${countSteps(node.children).total} under it` : null,
  ].filter(Boolean);

  return (
    <li id={`step-${node.id}`} className="scroll-mt-4 py-1">
      <div className="flex items-start gap-1 px-2">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={childrenId}
            aria-label={open ? `Fold ${node.title}` : `Unfold ${node.title}`}
            className="press mt-1 flex size-6 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-sunken"
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')}
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        )}
        <StatusGlyph
          glyph={STEP_STATUS_GLYPHS[node.status]}
          label={STEP_STATUS_LABELS[node.status]}
          className={cn('mt-2', closed ? 'text-ink-muted' : 'text-ink')}
        />
        <div className="min-w-0 flex-1">
          <form action={edit}>
            <input type="hidden" name="id" value={node.id} />
            <InlineInput
              name="title"
              required
              maxLength={STEP_TITLE_MAX}
              defaultValue={node.title}
              key={`title-${node.title}`}
              aria-label={`Rename ${node.title}`}
              disabled={editing}
              onBlur={commitOnBlur(node.title, { required: true })}
              className={cn(closed && 'text-ink-muted line-through')}
            />
          </form>
          <p className="flex flex-wrap items-center gap-x-2 px-1 text-small text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <KindIcon className="size-3" strokeWidth={1.75} aria-hidden />
              {STEP_KIND_LABELS[node.kind]}
            </span>
            {meta.map((line) => (
              <span key={line as string}>{line}</span>
            ))}
            {stepLinks.map((link) => (
              <Link key={link.linkId} href={`/goals/${link.goalId}`} className="underline">
                Also {link.title}
              </Link>
            ))}
          </p>
          {rhythm && rhythm.past.length > 0 && node.rhythmPeriod && (
            <PastPeriods past={rhythm.past} period={node.rhythmPeriod} />
          )}
          {node.kind === 'decision' && node.status === 'open' && node.resolution === null && (
            <AnswerForm id={node.id} title={node.title} />
          )}
          {awaitsReview(node) && <ClaudeResult node={node} />}
          {editState.error && <p className="px-1 text-small text-danger">{editState.error}</p>}
          {details && (
            <StepDetails node={node} links={stepLinks} otherGoals={otherGoals} edit={edit} />
          )}
        </div>
        <ActionMenu label={`${node.title} actions`} items={items} />
      </div>

      {(hasChildren || adding) && (
        <div id={childrenId} hidden={!open} className={cn(depth === 0 && 'pl-2')}>
          {hasChildren && (
            <StepList
              nodes={node.children}
              depth={depth + 1}
              links={links}
              otherGoals={otherGoals}
            />
          )}
          {adding && (
            <div className="ml-4 pl-1">
              <StepComposer
                parentId={node.id}
                label={`Sub-step of ${node.title}`}
                startOpen
                onClose={() => setAdding(false)}
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

const answerInitial: ShapingActionState = {};

/**
 * Answer a question Claude asked (plan #932). The answer is kept on the step
 * and the step closes; the next run on this goal reads it.
 */
function AnswerForm({ id, title }: { id: string; title: string }) {
  const [state, answer, answering] = useActionState(answerQuestionAction, answerInitial);
  return (
    <form action={answer} className="mt-1 space-y-1 px-1">
      <input type="hidden" name="id" value={id} />
      {/* ui-ok: the answer to this question, shown only while it is unanswered */}
      <Textarea
        name="answer"
        rows={2}
        required
        placeholder="Your answer"
        aria-label={`Your answer to ${title}`}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="secondary" pending={answering}>
          Answer
        </Button>
        {state.error && <span className="text-small text-danger">{state.error}</span>}
      </div>
    </form>
  );
}

/**
 * What the morning run produced for a Claude step (plan #933): the note or
 * draft, its link when it has one, and while it is unread a button to mark it
 * read, which takes it off the home. Once read it moves into the details.
 */
function ClaudeResult({ node }: { node: StepNode }) {
  const [state, review, reviewing] = useActionState(reviewResultAction, answerInitial);
  const unread = node.reviewedAt === null;
  return (
    <div className="mt-1 space-y-1 px-1">
      <p className="text-small text-ink-muted">{unread ? 'Claude’s result, to read' : 'Claude’s result'}</p>
      {node.result && (
        <p className="text-small break-words whitespace-pre-wrap text-ink">{node.result}</p>
      )}
      {node.resultUrl && (
        <a
          href={node.resultUrl}
          target="_blank"
          rel="noreferrer"
          className="block text-small break-all text-ink underline"
        >
          {node.resultUrl}
        </a>
      )}
      {unread && (
        <form action={review} className="flex items-center gap-2">
          <input type="hidden" name="id" value={node.id} />
          <Button type="submit" size="sm" variant="secondary" pending={reviewing}>
            Mark read
          </Button>
          {state.error && <span className="text-small text-danger">{state.error}</span>}
        </form>
      )}
    </div>
  );
}

const PERIOD_PLURAL = { day: 'days', week: 'weeks', month: 'months' } as const;

/**
 * The closed periods behind a rhythm's current one, oldest first: a tick for
 * each one kept and a cross for each one missed, read from the stored rows.
 */
function PastPeriods({
  past,
  period,
}: {
  past: RhythmRecord['past'];
  period: keyof typeof PERIOD_PLURAL;
}) {
  const kept = past.filter((row) => row.kept).length;
  const summary =
    past.length === 1
      ? `${kept === 1 ? 'Kept' : 'Missed'} last ${period}`
      : `Kept ${kept} of the last ${past.length} ${PERIOD_PLURAL[period]}`;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-small text-ink-muted">
      <span>{summary}</span>
      <span className="inline-flex items-center gap-0.5">
        {past.map((row) => (
          <StatusGlyph
            key={row.id}
            glyph={row.kept ? 'check' : 'cross'}
            label={`${period === 'day' ? formatDate(row.startsOn) : `From ${formatDate(row.startsOn)}`}: ${row.kept ? 'kept' : 'missed'}, ${row.count} of ${row.target}`}
            size={14}
            className={row.kept ? 'text-ink' : 'text-ink-muted'}
          />
        ))}
      </span>
    </div>
  );
}

function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * The rest of a step: what it involves, its done-when, its due date, its kind,
 * and the other goals it counts towards. Each field saves on its own when it
 * loses focus or changes.
 */
function StepDetails({
  node,
  links,
  otherGoals,
  edit,
}: {
  node: StepNode;
  links: { linkId: string; goalId: string; title: string }[];
  otherGoals: OtherGoals;
  edit: (form: FormData) => void;
}) {
  const menuAction = useMenuAction();
  const linkable = otherGoals.filter((goal) => !links.some((link) => link.goalId === goal.id));
  const [kind, setKind] = useState<StepKind>(node.kind);

  return (
    <div className="mt-2 space-y-2 rounded-control bg-sunken px-2 py-2">
      <form action={edit}>
        <input type="hidden" name="id" value={node.id} />
        {/* ui-ok: edits this step's own detail, shown only once Details is chosen */}
        <Textarea
          name="detail"
          rows={2}
          maxLength={STEP_DETAIL_MAX}
          defaultValue={node.detail ?? ''}
          key={`detail-${node.detail ?? ''}`}
          placeholder="What it involves"
          aria-label={`What ${node.title} involves`}
          onBlur={commitOnBlur(node.detail ?? '')}
        />
      </form>
      <form action={edit}>
        <input type="hidden" name="id" value={node.id} />
        <InlineInput
          name="acceptance"
          maxLength={STEP_ACCEPTANCE_MAX}
          defaultValue={node.acceptance ?? ''}
          key={`acceptance-${node.acceptance ?? ''}`}
          placeholder="Done when…"
          aria-label={`When ${node.title} is done`}
          onBlur={commitOnBlur(node.acceptance ?? '')}
        />
      </form>
      {node.resolution && (
        <p className="px-1 text-small text-ink">
          <span className="text-ink-muted">Answer: </span>
          {node.resolution}
        </p>
      )}
      {node.kind === 'claude' && !awaitsReview(node) && (node.result || node.resultUrl) && (
        <ClaudeResult node={node} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <form action={edit}>
          <input type="hidden" name="id" value={node.id} />
          <Input
            type="date"
            name="dueOn"
            defaultValue={node.dueOn ?? ''}
            key={`due-${node.dueOn ?? ''}`}
            aria-label={`When ${node.title} is due`}
            onChange={(event) => event.target.form?.requestSubmit()}
            className="w-auto"
          />
        </form>
        <form action={edit} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={node.id} />
          <Select
            name="kind"
            value={kind}
            aria-label={`What kind of step ${node.title} is`}
            onChange={(event) => {
              const next = event.target.value as StepKind;
              setKind(next);
              // A rhythm needs to say how often before it can be saved.
              if (next !== 'rhythm') event.target.form?.requestSubmit();
            }}
            className="w-auto"
          >
            {STEP_KINDS.map((option) => (
              <option key={option} value={option}>
                {STEP_KIND_LABELS[option]}
              </option>
            ))}
          </Select>
          {kind === 'rhythm' && (
            <RhythmFields
              count={node.rhythmCount}
              period={node.rhythmPeriod}
              submitLabel={node.kind === 'rhythm' ? 'Save' : 'Make it a rhythm'}
            />
          )}
        </form>
      </div>
      {(links.length > 0 || linkable.length > 0) && (
        <div className="space-y-1 px-1 text-small">
          {links.map((link) => (
            <form
              key={link.linkId}
              action={menuAction(unlinkStepAction)}
              className="flex items-center gap-2"
            >
              <input type="hidden" name="linkId" value={link.linkId} />
              <span className="text-ink-muted">Also counts towards</span>
              <span className="min-w-0 truncate text-ink">{link.title}</span>
              <Button type="submit" size="sm" variant="ghost">
                Remove
              </Button>
            </form>
          ))}
          {linkable.length > 0 && (
            <form action={menuAction(linkStepAction)} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={node.id} />
              <Select
                name="goalId"
                aria-label="Another goal this counts towards"
                className="w-auto"
              >
                {linkable.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm" variant="ghost">
                Count towards it too
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function RhythmFields({
  count,
  period,
  submitLabel,
}: {
  count: number | null;
  period: string | null;
  submitLabel?: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Input
        type="number"
        name="rhythmCount"
        min={1}
        max={RHYTHM_COUNT_MAX}
        required
        defaultValue={count ?? 1}
        aria-label="How many times"
        className="w-16"
      />
      <span className="text-small text-ink-muted">a</span>
      <Select
        name="rhythmPeriod"
        defaultValue={period ?? 'week'}
        aria-label="Per"
        className="w-auto"
      >
        {RHYTHM_PERIODS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
      {submitLabel && (
        <Button type="submit" size="sm" variant="ghost">
          {submitLabel}
        </Button>
      )}
    </span>
  );
}

/** A new step or sub-step: a title and its kind, with how often for a rhythm. */
function StepComposer({
  parentId,
  label,
  startOpen = false,
  onClose,
}: {
  parentId: string;
  label: string;
  startOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpenState] = useState(startOpen);
  const [kind, setKind] = useState<StepKind>('mine');
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) onClose?.();
  };
  const [state, add, adding] = useActionState(async (prev: StepActionState, form: FormData) => {
    const next = await addStep(prev, form);
    if (next.done) {
      setOpen(false);
      setKind('mine');
    }
    return next;
  }, initial);

  if (!open) return <AddTrigger label={label} onClick={() => setOpen(true)} />;

  return (
    <Card>
      <form
        action={add}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <input type="hidden" name="parentId" value={parentId} />
        <div className="px-3 py-3">
          <ComposeTitle
            name="title"
            required
            autoFocus
            maxLength={STEP_TITLE_MAX}
            placeholder="A step, such as list every balance"
            aria-label={label}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          <Select
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as StepKind)}
            aria-label="What kind of step"
            className="w-auto"
          >
            {STEP_KINDS.map((option) => (
              <option key={option} value={option}>
                {STEP_KIND_LABELS[option]}
              </option>
            ))}
          </Select>
          {kind === 'rhythm' && <RhythmFields count={null} period={null} />}
          {state.error && <span className="text-small text-danger">{state.error}</span>}
          <span className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={adding}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={adding}>
              {adding ? 'Adding…' : 'Add step'}
            </Button>
          </span>
        </div>
      </form>
    </Card>
  );
}
