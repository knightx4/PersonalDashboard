'use client';

import { formatDay } from '@/lib/goals/dates';
import { useActionState, useState } from 'react';
import { CircleUser, Repeat, Target } from 'lucide-react';
import { AnswerBox, TheAnswered, TheOptions, useAnswerDraft } from '@/components/dev/question';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipInput, ChipSelect, ComposeTitle, InlineInput, Textarea } from '@/components/ui/field';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { countProposed } from '@/lib/goals/shaping';
import {
  RHYTHM_COUNT_MAX,
  RHYTHM_PERIODS,
  STEP_ACCEPTANCE_MAX,
  STEP_DETAIL_MAX,
  STEP_KINDS,
  STEP_KIND_LABELS,
  STEP_TITLE_MAX,
  type StepKind,
  type StepNode,
} from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';
import type { RhythmRecord } from '@/lib/goals/rhythms';
import { addStep, editStep, linkStepAction, unlinkStepAction, type StepActionState } from './actions';
import {
  answerQuestionAction,
  reviewResultAction,
  setQuestionAsideAction,
  settleProposalAction,
  type ShapingActionState,
} from './shaping-actions';

/**
 * What a goal step has that a plan step does not (plan #982): the answer box
 * on a question, what Claude produced, a rhythm's past periods, the approve
 * and turn-down pair on a proposal, and the forms that add and edit a step.
 * The goal's row in goal-row.tsx puts these in the shared tree row's slots.
 */

const initial: StepActionState = {};

type OtherGoals = GoalMap['otherGoals'];

/** Wrap a row action for a menu, so a refusal is said in a toast rather than lost. */
export function useMenuAction() {
  const toast = useToast();
  return (action: (form: FormData) => Promise<{ error?: string }>) => async (form: FormData) => {
    const result = await action(form);
    if (result.error) toast({ text: result.error });
  };
}

const answerInitial: ShapingActionState = {};

/**
 * A question Claude asked (plan #932), answered with its options (plan #956).
 *
 * The lettered options in its detail are buttons, with the one Claude
 * recommends marked; pressing one writes it into the box, where it can be
 * sent as it is or said differently. Answering closes the step and the next
 * run reads the answer. Not now puts an unanswered question out of sight
 * until it is brought back. An answered question shows its answer and can be
 * given a new one, which is kept in the goal's history with the one it
 * replaced. The pieces are the dev plan's, from components/dev/question.tsx.
 */
export function Question({ node }: { node: StepNode }) {
  const [state, answerAction, answering] = useActionState(answerQuestionAction, answerInitial);
  const [asideState, asideAction, putting] = useActionState(setQuestionAsideAction, answerInitial);
  // The box is open when it was opened since the last answer was saved, so a
  // save closes it without an effect.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const saved = state.done ?? 0;
  const { answer, setAnswer, choose } = useAnswerDraft(() => setOpenedAt(saved));
  const unanswered = node.resolution === null;
  const aside = Boolean(node.dismissedAt);
  const changing = openedAt === saved;
  const answerable = unanswered || changing;

  return (
    <div className="mt-1 space-y-2 px-1">
      {node.resolution !== null && <TheAnswered resolution={node.resolution} />}
      {answerable && <TheOptions detail={node.detail} onChoose={choose} />}
      {answerable ? (
        <AnswerBox
          id={node.id}
          detail={node.detail}
          resolution={node.resolution}
          action={answerAction}
          pending={answering}
          answer={answer}
          onAnswer={setAnswer}
          autoFocus={!unanswered}
          onCancel={
            unanswered
              ? undefined
              : () => {
                  setAnswer('');
                  setOpenedAt(null);
                }
          }
          error={state.error ?? asideState.error}
          extra={
            unanswered && !aside ? (
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                formAction={asideAction}
                pending={putting}
              >
                Not now
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setAnswer('');
            setOpenedAt(saved);
          }}
        >
          Change the answer
        </Button>
      )}
      {unanswered && aside && (
        <form action={asideAction}>
          <input type="hidden" name="id" value={node.id} />
          <input type="hidden" name="aside" value="0" />
          <Button type="submit" size="sm" variant="secondary" pending={putting}>
            Bring back
          </Button>
        </form>
      )}
    </div>
  );
}

/**
 * What the morning run produced for a Claude step (plan #933): the note or
 * draft, its link when it has one, and while it is unread a button to mark it
 * read, which takes it off the home. Once read it moves into the details.
 *
 * On a step of yours it is what Claude prepared for you to do it (plan
 * #1001). That waits on the step itself, which is still yours to tick, so it
 * has no Mark read.
 */
export function ClaudeResult({ node }: { node: StepNode }) {
  const [state, review, reviewing] = useActionState(reviewResultAction, answerInitial);
  const prepared = node.kind !== 'claude';
  const unread = !prepared && node.reviewedAt === null;
  return (
    <div className="mt-1 space-y-1 px-1">
      <p className="text-small text-ink-muted">
        {prepared ? 'What Claude prepared for this' : unread ? 'Claude’s result, to read' : 'Claude’s result'}
      </p>
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
export function PastPeriods({
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

/** "3 Oct", as every Goals page prints a date (lib/goals/dates.ts). */
export function formatDate(isoDate: string): string {
  return formatDay(isoDate);
}
/**
 * Approve and Turn down beside a proposal's Needs line (plan #960), the same
 * two moves its menu offers.
 */
export function ProposalButtons({ node }: { node: StepNode }) {
  const [state, settle, settling] = useActionState(settleProposalAction, answerInitial);
  const beneath = countProposed(node.children);
  const with_ = beneath > 0 ? `, with ${beneath} beneath` : '';
  return (
    <form action={settle} className="mt-1.5 flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={node.id} />
      <Button type="submit" size="sm" name="approve" value="1" pending={settling}>
        Approve{with_}
      </Button>
      <Button type="submit" size="sm" variant="ghost" name="approve" value="0" disabled={settling}>
        Turn down{with_}
      </Button>
      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}

/** Drop the fields a save would leave as they were, so an edit sends only what changed. */
function onlyChanged(form: FormData, node: StepNode): FormData {
  const before: Record<string, string> = {
    title: node.title,
    detail: node.detail ?? '',
    acceptance: node.acceptance ?? '',
    dueOn: node.dueOn ?? '',
    startsOn: node.startsOn ?? '',
  };
  // The two dates go together when either changed, so the start can be
  // checked against the due date the form shows.
  const datesChanged = ['dueOn', 'startsOn'].some(
    (key) => String(form.get(key) ?? '').trim() !== before[key],
  );
  for (const [key, value] of Object.entries(before)) {
    if (datesChanged && (key === 'dueOn' || key === 'startsOn')) continue;
    if (String(form.get(key) ?? '').trim() === value) form.delete(key);
  }
  if (form.get('kind') === node.kind) {
    form.delete('kind');
    if (
      String(form.get('rhythmCount') ?? '') === String(node.rhythmCount ?? '') &&
      form.get('rhythmPeriod') === node.rhythmPeriod
    ) {
      form.delete('rhythmCount');
      form.delete('rhythmPeriod');
    }
  }
  return form;
}

/** The step's fields as one form. Save puts the text view back; Cancel leaves it as it was. */
export function StepEditForm({
  node,
  links,
  otherGoals,
  onDone,
}: {
  node: StepNode;
  links: { linkId: string; goalId: string; title: string }[];
  otherGoals: OtherGoals;
  onDone: () => void;
}) {
  const menuAction = useMenuAction();
  const linkable = otherGoals.filter((goal) => !links.some((link) => link.goalId === goal.id));
  const [kind, setKind] = useState<StepKind>(node.kind);
  const [state, save, saving] = useActionState(
    async (prev: StepActionState, form: FormData) => {
      const result = await editStep(prev, onlyChanged(form, node));
      if (!result.error) onDone();
      return result;
    },
    initial,
  );

  return (
    <div className="space-y-2 rounded-control bg-sunken px-2 py-2">
      <form action={save} className="space-y-2">
        <input type="hidden" name="id" value={node.id} />
        <InlineInput
          name="title"
          required
          maxLength={STEP_TITLE_MAX}
          defaultValue={node.title}
          aria-label={`Rename ${node.title}`}
          autoFocus
        />
        {/* ui-ok: composer-always-open -- this form only renders once Edit is pressed */}
        <Textarea
          name="detail"
          rows={3}
          maxLength={STEP_DETAIL_MAX}
          defaultValue={node.detail ?? ''}
          placeholder="What it involves"
          aria-label={`What ${node.title} involves`}
        />
        <InlineInput
          name="acceptance"
          maxLength={STEP_ACCEPTANCE_MAX}
          defaultValue={node.acceptance ?? ''}
          placeholder="Done when…"
          aria-label={`When ${node.title} is done`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <ChipInput
            type="date"
            name="startsOn"
            icon="Start"
            defaultValue={node.startsOn ?? ''}
            aria-label={`The first day ${node.title} can be done`}
            title="Until this day the step stays off your list and out of Claude's runs"
          />
          <ChipInput
            type="date"
            name="dueOn"
            icon="Due"
            defaultValue={node.dueOn ?? ''}
            aria-label={`When ${node.title} is due`}
          />
          <KindChip
            value={kind}
            onChange={setKind}
            label={`What kind of step ${node.title} is`}
          />
          {kind === 'rhythm' && (
            <RhythmFields count={node.rhythmCount} period={node.rhythmPeriod} />
          )}
        </div>
        {state.error && <p className="px-1 text-small text-danger">{state.error}</p>}
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" pending={saving}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
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
              <ChipSelect
                name="goalId"
                aria-label="Another goal this counts towards"
                icon={<Target className="size-3.5" strokeWidth={2} />}
              >
                {linkable.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title}
                  </option>
                ))}
              </ChipSelect>
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

/**
 * What kind of step it is, as a chip carrying its own value, the way the dev
 * plan's composer sets priority and assignee (app/dev/plan/step-forms.tsx).
 * It was a boxed select, the one bordered control in a row of words.
 */
function KindChip({
  value,
  onChange,
  label,
}: {
  value: StepKind;
  onChange: (kind: StepKind) => void;
  label: string;
}) {
  return (
    <ChipSelect
      name="kind"
      value={value}
      onChange={(event) => onChange(event.target.value as StepKind)}
      aria-label={label}
      icon={<CircleUser className="size-3.5" strokeWidth={2} />}
    >
      {STEP_KINDS.map((option) => (
        <option key={option} value={option}>
          {STEP_KIND_LABELS[option]}
        </option>
      ))}
    </ChipSelect>
  );
}

/** How often a rhythm comes round, read as the sentence it is: "3 a week". */
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
    <span className="inline-flex flex-wrap items-center gap-0.5">
      <ChipInput
        type="number"
        name="rhythmCount"
        min={1}
        max={RHYTHM_COUNT_MAX}
        required
        defaultValue={count ?? 1}
        aria-label="How many times"
        icon={<Repeat className="size-3.5" strokeWidth={2} />}
      />
      <span className="text-ui text-ink-muted">a</span>
      <ChipSelect name="rhythmPeriod" defaultValue={period ?? 'week'} aria-label="Per">
        {RHYTHM_PERIODS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </ChipSelect>
      {submitLabel && (
        <Button type="submit" size="sm" variant="ghost">
          {submitLabel}
        </Button>
      )}
    </span>
  );
}

/**
 * A new step or sub-step: a title and its kind, with how often for a rhythm.
 *
 * `bare` is for a composer opened inside the Steps card, at its foot or in a
 * row's sub-step slot: the form sits on the card's ground under the rule
 * already there instead of drawing a card inside the card (plan #1041). The
 * framed one is for a goal with no steps, where there is no card around it.
 */
export function StepComposer({
  parentId,
  label,
  startOpen = false,
  bare = false,
  onClose,
}: {
  parentId: string;
  label: string;
  startOpen?: boolean;
  bare?: boolean;
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

  const form = (
    <form
      action={add}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false);
      }}
      className={cn(bare && 'space-y-2')}
    >
      <input type="hidden" name="parentId" value={parentId} />
      <div className={cn(!bare && 'px-3 py-3')}>
        <ComposeTitle
          name="title"
          required
          autoFocus
          maxLength={STEP_TITLE_MAX}
          placeholder="A step, such as list every balance"
          aria-label={label}
        />
      </div>
      <div
        className={cn(
          'flex flex-wrap items-center gap-2',
          !bare && 'border-t border-border px-3 py-2',
        )}
      >
        <KindChip value={kind} onChange={setKind} label="What kind of step" />
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
  );

  return bare ? form : <Card>{form}</Card>;
}
