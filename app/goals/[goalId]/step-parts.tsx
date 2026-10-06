'use client';

import { formatDay } from '@/lib/goals/dates';
import { useActionState, useRef, useState, useTransition } from 'react';
import { CircleUser, Repeat, Target } from 'lucide-react';
import { AnswerBox, TheAnswered, TheOptions, useAnswerDraft } from '@/components/dev/question';
import { FileBody } from '@/components/files/file-body';
import { FileLinks } from '@/components/files/file-links';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EditableProse } from '@/components/ui/editable-prose';
import { ChipInput, ChipSelect, ComposeTitle, InlineInput, Select } from '@/components/ui/field';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import type { LinkedFile } from '@/lib/files/files';
import type { StepPrep } from '@/lib/goals/goal-page';
import { PROGRESS_UNIT_MAX } from '@/lib/goals/progress';
import { COUNT_MATCH_MAX, COUNT_SOURCE_CHOICES, COUNT_SOURCES } from '@/lib/goals/rhythm-sources';
import { countProposed } from '@/lib/goals/shaping';
import {
  RHYTHM_COUNT_MAX,
  RHYTHM_PERIODS,
  STEP_KINDS,
  STEP_KIND_LABELS,
  STEP_TITLE_MAX,
  type StepKind,
  type StepNode,
} from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';
import type { RhythmRecord } from '@/lib/goals/rhythms';
import {
  addStep,
  editStep,
  linkStepAction,
  unlinkStepAction,
  type StepActionState,
} from './actions';
import {
  answerQuestionAction,
  reviewResultAction,
  setQuestionAsideAction,
  settleProposalAction,
  type ShapingActionState,
} from './shaping-actions';
import { DashCredit } from '@/components/ui/dash-mark';

/**
 * What a goal step has that a plan step does not (plan #982): the answer box
 * on a question, what Claude produced, a rhythm's past periods, the approve
 * and turn-down pair on a proposal, the composer that adds a step, and the
 * pieces that edit one where it is read.
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
 *
 * The text is markdown. A longer piece is kept as a file (core.files) and the
 * result is its summary, with the file linked under it.
 */
export function ClaudeResult({ node, files = [] }: { node: StepNode; files?: LinkedFile[] }) {
  const [state, review, reviewing] = useActionState(reviewResultAction, answerInitial);
  const prepared = node.kind !== 'claude';
  const unread = !prepared && node.reviewedAt === null;
  return (
    <div className="mt-1 space-y-1 px-1">
      <p className="text-small text-ink-muted">
        <DashCredit />
        {prepared
          ? 'What Dash prepared for this'
          : unread
            ? 'Dash’s result, to read'
            : 'Dash’s result'}
      </p>
      {node.result && <FileBody markdown={node.result} compact />}
      {files.length > 0 && <FileLinks files={files} />}
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

/**
 * The Dash step that prepares one of yours, said on your step (plan #1218):
 * "Dash is preparing" with the prep step's title while it is open, "Dash
 * prepared" with the first sentence of its result once done. Either links to
 * the prep step's row, which opens on the link and holds the whole result.
 * Prepare (the button) writes onto the step itself and shows in ClaudeResult;
 * this is what Dash does unasked, as a step of its own.
 */
export function PrepNote({ prep }: { prep: StepPrep }) {
  const href = `#step-${prep.id}`;
  return (
    <p className="mt-1 px-1 text-small text-ink-muted">
      {prep.done ? 'Dash prepared: ' : 'Dash is preparing: '}
      {prep.done && prep.line ? (
        <>
          <span className="text-ink">{prep.line}</span>{' '}
          <a href={href} className="underline underline-offset-2">
            Read it
          </a>
        </>
      ) : (
        <a href={href} className="text-ink underline underline-offset-2">
          {prep.title}
        </a>
      )}
    </p>
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
    estimatedTotal: node.estimatedTotal ? String(node.estimatedTotal) : '',
    totalUnit: node.totalUnit ?? '',
    countSource: node.countSource ?? '',
    countMatch: node.countMatch ?? '',
  };
  // The two dates go together when either changed, so the start can be
  // checked against the due date the form shows.
  const datesChanged = ['dueOn', 'startsOn'].some(
    (key) => String(form.get(key) ?? '').trim() !== before[key],
  );
  // The total and what it counts go together too, since one means nothing
  // without the other (plan #1277).
  const totalChanged = ['estimatedTotal', 'totalUnit'].some(
    (key) => String(form.get(key) ?? '').trim() !== before[key],
  );
  // So do a rhythm's source and its match text (goals migration 0069).
  const sourceChanged = ['countSource', 'countMatch'].some(
    (key) => form.has(key) && String(form.get(key) ?? '').trim() !== before[key],
  );
  for (const [key, value] of Object.entries(before)) {
    if (datesChanged && (key === 'dueOn' || key === 'startsOn')) continue;
    if (totalChanged && (key === 'estimatedTotal' || key === 'totalUnit')) continue;
    if (sourceChanged && (key === 'countSource' || key === 'countMatch')) continue;
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

/** Send one change to a step: the fields in `values`, and nothing else. */
async function saveStep(id: string, values: Record<string, string>): Promise<string | null> {
  const form = new FormData();
  form.set('id', id);
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  const result = await editStep(initial, form);
  return result.error ?? null;
}

/**
 * The step's title, renamed where it is read (plan #1435). Enter or leaving
 * the box saves it; Escape puts it back as it was.
 */
export function StepTitleEditor({ node, onDone }: { node: StepNode; onDone: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const cancelled = useRef(false);
  return (
    <InlineInput
      name="title"
      required
      maxLength={STEP_TITLE_MAX}
      defaultValue={node.title}
      aria-label={`Rename ${node.title}`}
      autoFocus
      disabled={pending}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelled.current = true;
          onDone();
        }
      }}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (cancelled.current || !next || next === node.title) {
          onDone();
          return;
        }
        start(async () => {
          const error = await saveStep(node.id, { title: next });
          if (error) toast({ text: error });
          onDone();
        });
      }}
    />
  );
}

/**
 * What a step involves, or when it is done, as writing you press to change
 * (plan #1435). It was a textarea in a form opened from the menu; now the
 * words in the step's panel are the editor.
 */
export function StepText({ node, field }: { node: StepNode; field: 'detail' | 'acceptance' }) {
  const detail = field === 'detail';
  return (
    <EditableProse
      value={(detail ? node.detail : node.acceptance) ?? ''}
      label={detail ? `What ${node.title} involves` : `When ${node.title} is done`}
      empty={detail ? 'Say what it involves' : 'Say when it is done'}
      placeholder={detail ? 'What it involves' : 'Done when…'}
      onSave={(next) => saveStep(node.id, { [field]: next })}
    />
  );
}

/**
 * The step's properties as chips that save as they change (plan #1435): the
 * start and due days, its kind, how often a rhythm comes round, and about how
 * many in all. Then the other goals it counts towards. These were the foot of
 * a form with a Save button; each now saves on its own.
 */
export function StepFacts({
  node,
  links,
  otherGoals,
}: {
  node: StepNode;
  links: { linkId: string; goalId: string; title: string }[];
  otherGoals: OtherGoals;
}) {
  const menuAction = useMenuAction();
  const linkable = otherGoals.filter((goal) => !links.some((link) => link.goalId === goal.id));
  const [kind, setKind] = useState<StepKind>(node.kind);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, save, saving] = useActionState(async (prev: StepActionState, form: FormData) => {
    // A step turned into a rhythm before its count is drawn comes round
    // once a week until it is told otherwise.
    if (form.get('kind') === 'rhythm' && !form.get('rhythmCount')) {
      form.set('rhythmCount', '1');
      form.set('rhythmPeriod', 'week');
    }
    return editStep(prev, onlyChanged(form, node));
  }, initial);

  // Saves once the change is whole: a total waits for what it counts, and
  // what it counts for the total.
  const commit = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const total = String(data.get('estimatedTotal') ?? '').trim();
    const unit = String(data.get('totalUnit') ?? '').trim();
    if (data.has('estimatedTotal') && Boolean(total) !== Boolean(unit)) return;
    // A calendar source waits for the text its events are matched on.
    if (data.get('countSource') === 'calendar' && !String(data.get('countMatch') ?? '').trim()) return;
    form.requestSubmit();
  };

  return (
    <div className="space-y-1">
      <form
        ref={formRef}
        action={save}
        className="-ml-1.5 flex flex-wrap items-center gap-1"
        aria-busy={saving}
      >
        <input type="hidden" name="id" value={node.id} />
        <ChipInput
          type="date"
          name="startsOn"
          icon="Start"
          defaultValue={node.startsOn ?? ''}
          onChange={commit}
          aria-label={`The first day ${node.title} can be done`}
          title="Until this day the step stays off your list and out of Dash's runs"
        />
        <ChipInput
          type="date"
          name="dueOn"
          icon="Due"
          defaultValue={node.dueOn ?? ''}
          onChange={commit}
          aria-label={`When ${node.title} is due`}
        />
        <KindChip
          value={kind}
          onChange={(next) => {
            setKind(next);
            commit();
          }}
          label={`What kind of step ${node.title} is`}
        />
        {kind === 'rhythm' && (
          <RhythmFields count={node.rhythmCount} period={node.rhythmPeriod} onCommit={commit} />
        )}
        {kind === 'rhythm' && <CountSourceFields node={node} onCommit={commit} />}
        {(kind === 'mine' || kind === 'claude') && (
          <span className="inline-flex items-center">
            <ChipInput
              type="text"
              inputMode="decimal"
              name="estimatedTotal"
              icon="About"
              defaultValue={node.estimatedTotal ?? ''}
              placeholder="how many"
              size={8}
              onBlur={commit}
              aria-label={`About how many in all for ${node.title}`}
              title="An estimate: the step says roughly how much is left from it"
            />
            <ChipInput
              type="text"
              name="totalUnit"
              maxLength={PROGRESS_UNIT_MAX}
              defaultValue={node.totalUnit ?? ''}
              placeholder="bags"
              size={8}
              onBlur={commit}
              aria-label={`What the total for ${node.title} counts`}
            />
          </span>
        )}
        {saving && <span className="text-small text-ink-muted">Saving…</span>}
      </form>
      {state.error && <p className="px-1 text-small text-danger">{state.error}</p>}
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
  onCommit,
}: {
  count: number | null;
  period: string | null;
  submitLabel?: string;
  /** Saves the change where the fields stand on a step rather than in a composer. */
  onCommit?: () => void;
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
        onBlur={onCommit}
        aria-label="How many times"
        icon={<Repeat className="size-3.5" strokeWidth={2} />}
      />
      <span className="text-ui text-ink-muted">a</span>
      <ChipSelect
        name="rhythmPeriod"
        defaultValue={period ?? 'week'}
        onChange={onCommit}
        aria-label="Per"
      >
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
 * Where a rhythm's count is read from, so the period is kept without logging
 * anything (lib/goals/rhythm-sources.ts): nothing, applications sent in Jobs,
 * or calendar events whose title contains the match text.
 */
function CountSourceFields({ node, onCommit }: { node: StepNode; onCommit: () => void }) {
  const [source, setSource] = useState(node.countSource ?? '');
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5">
      <span className="text-ui text-ink-muted">Counts itself from</span>
      {/* A full-size select, so a thumb can reach it on a phone. */}
      <Select
        name="countSource"
        value={source}
        className="w-auto max-sm:min-h-11"
        onChange={(event) => {
          setSource(event.target.value);
          // The form reads the select after React has drawn the match box.
          requestAnimationFrame(onCommit);
        }}
        aria-label={`Where the count for ${node.title} comes from`}
      >
        <option value="">nothing, counted by hand</option>
        {COUNT_SOURCES.map((option) => (
          <option key={option} value={option}>
            {COUNT_SOURCE_CHOICES[option]}
          </option>
        ))}
      </Select>
      {source === 'calendar' && (
        <ChipInput
          type="text"
          name="countMatch"
          maxLength={COUNT_MATCH_MAX}
          defaultValue={node.countMatch ?? ''}
          placeholder="urbanism|community board"
          size={20}
          onBlur={onCommit}
          aria-label={`What a calendar event for ${node.title} is called`}
          title="An event counts when its title contains this. Separate alternatives with |."
        />
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
