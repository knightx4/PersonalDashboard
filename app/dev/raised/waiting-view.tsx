'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  answerPlanDecision,
  approvePlanItem,
  approveProposals,
  setPlanItemStatus,
  type PlanActionState,
} from '@/app/dev/plan/actions';
import { Button } from '@/components/ui/button';
import { CommentThread } from '@/components/dev/comment-thread';
import { AnswerBox, TheAnswered, TheOptions, useAnswerDraft } from '@/components/dev/question';
import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { FieldError } from '@/components/ui/field';
import { RefText } from '@/components/dev/ref-text';
import { planRefHref, type PlanRefTitles } from '@/lib/comments/refs';
import { MODULES, type ModuleId } from '@/lib/modules';
import { PLAN_HEALTH_GLYPHS } from '@/lib/status-glyphs';
import { WAITING_WORD } from '@/lib/dev/words';
import type { WaitingEntry, WaitingRow } from '@/lib/plan/waiting';

const MODULE_LABEL: Record<ModuleId, string> = Object.fromEntries(
  MODULES.map((module) => [module.id, module.label]),
) as Record<ModuleId, string>;

/**
 * Stopped is the one that costs something. A question can sit a day and
 * nothing is worse for it, and a proposal costs nothing until you want it; a
 * step that has stopped is work already begun and not moving. A setup job
 * takes the same tone as stopped, because it is the same cost seen a day
 * earlier: something on the plan is waiting on it and only you can do it.
 */
const TONE: Record<WaitingRow['health'], DevTone> = {
  blocked: 'caution',
  setup: 'caution',
  unanswered: 'accent',
  proposed: 'quiet',
};

/**
 * What the box asks for, which is not the same thing on all four kinds.
 *
 * A question wants what you are weighing; a step that has stopped wants what
 * you know about the thing it is stopped on; a proposal wants the doubt that
 * is keeping you from saying yes. One placeholder for all of them would have
 * to be vague enough to fit a proposal and a missing token at once.
 */
const PLACEHOLDER: Record<WaitingRow['health'], string> = {
  blocked: 'What you know about what it is waiting on. Tag @dash to ask.',
  setup: 'Where you have got to with this, or what is in the way. Tag @dash to ask.',
  unanswered: 'What is unclear about the question, or what you are weighing. Tag @dash to ask.',
  proposed: 'What you want changed before this is approved. Tag @dash to ask.',
};

/**
 * A plan step that cannot move until you do something, drawn beside the raises
 * rather than under a heading of its own.
 *
 * Dash asked one table what was waiting on you, and a step blocked on
 * something only you can supply was not in it: #499 needed a GitHub token for
 * a day while this page said nothing was waiting. The request had gone where
 * the plan skill sends it -- `block <n> --note`, into the step's own comment
 * column -- and no page read that column.
 *
 * Two lists under one heading rather than two headings, because "what is
 * waiting on me" is one question and answering it in two places is how the
 * second place stops being read.
 */
export function WaitingCard({ row, titles }: { row: WaitingRow; titles?: PlanRefTitles }) {
  const setup = row.health === 'setup';
  const question = row.health === 'unanswered';
  const blocked = row.health === 'blocked';
  const proposed = row.health === 'proposed';

  return (
    <li className="space-y-1 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* The row itself, not the top of the plan. Every one of these is a
            discrete thing to go and settle, and landing on the plan page and
            hunting for the number is what made the list feel like it was
            saying something was waiting without saying what. `planRefHref`
            is the same link a `#494` in a comment makes -- it asks for the
            All view, so a row a filter would have hidden is still reached. */}
        <Link
          href={planRefHref(row.number)}
          className="text-body font-semibold text-ink hover:underline"
        >
          #{row.number} {row.title}
        </Link>
        <StateLabel
          glyph={PLAN_HEALTH_GLYPHS[row.health]}
          word={WAITING_WORD[row.health]}
          tone={TONE[row.health]}
        />
      </div>

      {/* The title above is the one-line summary and this is what you have to
          actually go and do -- #599 asked for both, and on a setup row the two
          are the whole of the errand, so the instructions keep their line
          breaks rather than being run together into a gloss.

          A question is the exception: its ask is the same string the answering
          box reads its options out of, so drawing both would be the same
          paragraph twice. */}
      {row.ask && !question && (
        <p
          className={
            setup ? 'whitespace-pre-wrap text-small text-ink' : 'text-small text-ink-muted'
          }
        >
          <RefText text={row.ask} titles={titles} />
        </p>
      )}

      {question && <AnswerQuestion row={row} />}

      {/* The same thread the plan page keeps on the step, on the page the row
          is read from. Dash could be answered but not talked to: a raise took
          a comment and a plan row did not, so saying "this one is waiting on
          the other half of #612" meant going to the plan and finding the
          number. The write is against the step either way, so what is said
          here is on the row when you next open it there. */}
      <CommentThread
        target="step"
        id={row.id}
        thread={row.thread}
        label="Comment"
        placeholder={PLACEHOLDER[row.health]}
        titles={titles}
      />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-micro text-ink-ghost">
          {row.module ? MODULE_LABEL[row.module] : 'Everything'}
        </p>
        {setup && <SetupDone row={row} />}
        {blocked && <BlockedDone row={row} />}
        {proposed && <ApprovePlanRow row={row} />}
      </div>
    </li>
  );
}

/**
 * The press that closes a setup job, on the page where you read it.
 *
 * #599 settled that a setup row is read here as well as under its feature, and
 * that closing it should not mean going to the plan and finding the row again:
 * the whole cost of one of these is that it is small and you are somewhere
 * else. So the same action the plan page's box drives is driven from here.
 *
 * A one-press Done is the right control for this kind and the wrong one for the
 * two that are closed by words: a question gets the answering box above
 * instead, and a proposal is closed by an approval. A blocked step gets its own
 * press, `BlockedDone` below, which writes a different status for a different
 * reason. A setup job is finished by you having gone and done it, and "I have"
 * is the whole of what there is to record.
 *
 * `setPlanItemStatus` writes `done` and no commit, which is right: nothing was
 * built, and `commit_sha` stays null the same way it does on an answered
 * decision.
 */
function SetupDone({ row }: { row: WaitingRow }) {
  const [state, action, pending] = useActionState(setPlanItemStatus, {} as PlanActionState);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="status" value="done" />
      <FieldError>{state.error}</FieldError>
      <Button type="submit" size="sm" pending={pending}>
        I have set this up
      </Button>
    </form>
  );
}

/**
 * The press that starts a stopped step again, on the page where you read it.
 *
 * A blocked step is work that began and stopped on something outside the repo
 * -- a token to add, a setting to change -- and the sentence saying what it
 * needs is already on the card above. Until now the only way to say you had
 * done that thing was the plan page's status control, which meant leaving Dash,
 * finding the number and picking a status out of a list. The thing you want to
 * say is one word, so it is one press.
 *
 * Not `done`: nothing was built. `not_started` is what the step becomes -- the
 * work it was blocked mid-way through is still outstanding and is now somebody's
 * to pick up. `setPlanItemStatus` writes that through `blockPatch`, which drops
 * both the ask and the kind of block on the way out, so the row stops being
 * blocked, stops being drawn here, and reads on the plan page as a step nobody
 * has claimed.
 *
 * It says "I have done this" rather than "Unblock" because that is the claim
 * being made. Pressing it does not mean the block was wrong; it means the thing
 * it was waiting for has happened.
 */
function BlockedDone({ row }: { row: WaitingRow }) {
  const [state, action, pending] = useActionState(setPlanItemStatus, {} as PlanActionState);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="status" value="not_started" />
      <FieldError>{state.error}</FieldError>
      <Button type="submit" size="sm" pending={pending}>
        I have done this
      </Button>
    </form>
  );
}

/**
 * The press that says yes to one proposal, on the page where you read it.
 *
 * A proposal is the one kind here that is finished by agreeing to it: nothing
 * has to be typed and nothing has to be gone and done. Until now Dash could
 * only tell you a proposal was waiting, and saying yes meant opening the plan,
 * finding the number and going through the row's status menu.
 *
 * `approvePlanItem` is the plan page's own action and it approves the row
 * together with every proposal beneath it, which is why the label says how
 * many are coming with it. `proposedBeneath` is that count, worked out where
 * the row was flattened out of the tree.
 *
 * The one press every other proposal on the list gets too, and it stays on the
 * row even with Approve all above the group: #630 settled that approving the
 * lot is for proposals as a set, and a proposal you want and three you have
 * not read yet is still a row-at-a-time job.
 */
function ApprovePlanRow({ row }: { row: WaitingRow }) {
  const [state, action, pending] = useActionState(approvePlanItem, {} as PlanActionState);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={row.id} />
      <FieldError>{state.error}</FieldError>
      <Button type="submit" size="sm" pending={pending}>
        {row.proposedBeneath > 0 ? `Approve, with ${row.proposedBeneath} beneath` : 'Approve'}
      </Button>
    </form>
  );
}

/**
 * One press for every proposal in the group.
 *
 * The group is mostly one shaped feature at a time -- the feature and its five
 * steps arrive together and are read together -- so the common answer to the
 * whole group is one yes, and asking for six presses is asking you to do the
 * same thing six times.
 *
 * It says how many it will approve rather than just "Approve all", because
 * this sits above a list you may have scrolled past: #630's answer is that the
 * count is the guard, in place of a confirm step nothing else on these pages
 * asks for.
 *
 * Plan rows only. A request from a session can be drawn in this group as well
 * -- #622 puts one that named an action here -- and a yes on one of those runs
 * what it named, there and then, including handing a step to a routine that
 * starts building. That is not a thing to do to rows you have not read one at
 * a time, so those keep their own buttons and are not counted here.
 */
export function ApproveAll({ entries }: { entries: readonly WaitingEntry[] }) {
  const [state, action, pending] = useActionState(approveProposals, {} as PlanActionState);

  const proposals = entries.filter((entry) => entry.kind === 'plan');
  if (proposals.length === 0) return null;

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {proposals.map((entry) => (
        <input key={entry.id} type="hidden" name="id" value={entry.id} />
      ))}
      <FieldError>{state.error}</FieldError>
      <Button type="submit" size="sm" variant="secondary" pending={pending}>
        Approve all {proposals.length}
      </Button>
    </form>
  );
}

/**
 * A question answered where you read it, rather than on the plan page.
 *
 * The list on Dash said a question was waiting and gave you its number; the
 * answering was somewhere else, so settling one meant opening the plan, finding
 * the row and scrolling to the same box. The box is `components/dev/question`
 * now and this is the plan page's questions list in miniature: the options as
 * buttons that fill the answer in, any answer already recorded above them, and
 * the box itself opened by a press rather than standing open on every card.
 *
 * The question is not restated. The card's own heading is the question, and
 * `TheQuestion` under it would be the same sentence twice.
 *
 * `answerPlanDecision` is the same write the plan page makes, and it
 * revalidates this page as well as that one, so answering takes the row off
 * the list rather than leaving it sitting there answered.
 */
function AnswerQuestion({ row }: { row: WaitingRow }) {
  const [state, action, pending] = useActionState(answerPlanDecision, {} as PlanActionState);
  const [answering, setAnswering] = useState(false);
  const { answer, setAnswer, choose } = useAnswerDraft(() => setAnswering(true));

  return (
    <div className="space-y-2">
      <TheOptions detail={row.detail} onChoose={choose} />

      {row.resolution && <TheAnswered resolution={row.resolution} />}

      {answering ? (
        <AnswerBox
          id={row.id}
          detail={row.detail}
          resolution={row.resolution}
          action={action}
          pending={pending}
          answer={answer}
          onAnswer={setAnswer}
          autoFocus
          error={state.error}
          onCancel={() => {
            setAnswer('');
            setAnswering(false);
          }}
        />
      ) : (
        <Button type="button" size="sm" variant="ghost" onClick={() => setAnswering(true)}>
          {row.resolution ? 'Change the answer' : 'Answer'}
        </Button>
      )}
    </div>
  );
}
