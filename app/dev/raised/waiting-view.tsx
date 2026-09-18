'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { setPlanItemStatus, type PlanActionState } from '@/app/dev/plan/actions';
import { Button } from '@/components/ui/button';
import { StateLabel, type DevTone } from '@/components/dev/state-label';
import { FieldError } from '@/components/ui/field';
import { RefText } from '@/components/dev/ref-text';
import { planRefHref, type PlanRefTitles } from '@/lib/comments/refs';
import { MODULES, type ModuleId } from '@/lib/modules';
import { PLAN_HEALTH_GLYPHS } from '@/lib/status-glyphs';
import { WAITING_WORD } from '@/lib/dev/words';
import type { WaitingRow } from '@/lib/plan/waiting';

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
          breaks rather than being run together into a gloss. */}
      {row.ask && (
        <p className={setup ? 'whitespace-pre-wrap text-small text-ink' : 'text-small text-ink-muted'}>
          <RefText text={row.ask} titles={titles} />
        </p>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-micro text-ink-ghost">
          {row.module ? MODULE_LABEL[row.module] : 'Everything'}
        </p>
        {setup && <SetupDone row={row} />}
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
 * The other three kinds get no button, and that is the difference between them.
 * A question and a proposal are closed by words -- an answer, an approval --
 * and a one-press Done on either would be closing a decision with nothing
 * recorded against it. A blocked step is cleared by whatever it was blocked on
 * arriving, not by saying it is fine. A setup job is the one that is finished
 * by you having gone and done it, and "I have" is the whole of what there is
 * to record.
 *
 * `setPlanItemStatus` writes `done` and no commit, which is right: nothing was
 * built, and `commit_sha` stays null the same way it does on an answered
 * decision.
 */
function SetupDone({ row }: { row: WaitingRow }) {
  const [state, action, pending] = useActionState(
    setPlanItemStatus,
    {} as PlanActionState,
  );

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
