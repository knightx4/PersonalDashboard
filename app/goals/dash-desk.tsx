'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Folder, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashMark } from '@/components/ui/dash-mark';
import { PaidHint } from '@/components/ui/paid-hint';
import { ChipInput, ChipSelect, ComposeBody, ComposeBox } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import type { DashOffer } from '@/lib/goals/hand-off';
import type { RunListing } from '@/lib/goals/runs';
import { prepareStepAction, workOnGoalAction } from './[goalId]/shaping-actions';
import { askDashAction, type AskDashState } from './home-actions';

/**
 * Put Dash to work, on the Goals home: what Dash is doing now, a few things
 * it could take in one press, and Ask Dash for anything else.
 *
 * - Working now: each run going, with what it last said it was on.
 * - Dash could take these (lib/goals/hand-off.ts): steps of yours it could
 *   prepare, and goals it has left alone, each with the one button that
 *   starts it. A press says so in the row rather than leaving it.
 * - Ask Dash: words, and where they go. On a goal they are an @dash comment
 *   on it, answered in the goal's thread or by a run; as a new errand they
 *   are saved with a due date and handed to Dash in the same press. It
 *   replaces Add an errand.
 *
 * Each run uses the goal page's own actions, so a refusal reads the same in
 * both places.
 */

export type DashDeskProps = {
  working: RunListing[];
  offers: DashOffer[];
  /** The open goals, for where an ask goes. */
  goals: { id: string; title: string }[];
  /** Your live areas, for a new errand; none leaves the errand choice out. */
  areas: { id: string; name: string }[];
  /** The area a new errand starts in (errandAreaDefault). */
  defaultAreaId: string | null;
};

export function DashDesk({ working, offers, goals, areas, defaultAreaId }: DashDeskProps) {
  return (
    <section aria-labelledby="dash-desk-heading" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id="dash-desk-heading" className="inline-flex items-center gap-1.5 text-ui font-semibold text-ink">
          <DashMark size="xs" tone="brand" decorative />
          Put Dash to work
        </h2>
        <Link
          href="/goals/runs"
          className="text-small text-accent underline-offset-2 hover:underline"
        >
          Every run
        </Link>
      </div>
      <Card>
        {working.length > 0 && (
          <ul className="divide-y divide-border border-b border-border">
            {working.map((run) => (
              <WorkingRow key={run.id} run={run} />
            ))}
          </ul>
        )}
        {offers.length > 0 && (
          <div className="border-b border-border">
            <p className="card-pad-x pt-3 text-small font-semibold text-ink-muted">
              Dash could take these
            </p>
            <ul className="divide-y divide-border">
              {offers.map((offer) => (
                <OfferRow key={offer.kind === 'prepare' ? offer.stepId : offer.goalId} offer={offer} />
              ))}
            </ul>
          </div>
        )}
        <AskDash goals={goals} areas={areas} defaultAreaId={defaultAreaId} />
      </Card>
    </section>
  );
}

function WorkingRow({ run }: { run: RunListing }) {
  const on = run.nowOn?.trim() || run.item?.title || run.area?.name || 'the morning run';
  return (
    <li className="card-pad-x row-pad flex items-center gap-2">
      <DashMark state="working" activity="thinking" size="xs" tone="brand" decorative />
      <span className="min-w-0 flex-1 text-small break-words text-ink">
        Dash is working on <span className="font-semibold">{on}</span>
      </span>
      <Link
        href={`/goals/runs/${run.id}`}
        className="shrink-0 text-small text-accent underline-offset-2 hover:underline"
      >
        Watch
      </Link>
    </li>
  );
}

type RunState = { error?: string; message?: string; done?: number };

function OfferRow({ offer }: { offer: DashOffer }) {
  const [state, action, pending] = useActionState(
    (prev: RunState, form: FormData) =>
      offer.kind === 'prepare' ? prepareStepAction(prev, form) : workOnGoalAction(prev, form),
    {} as RunState,
  );
  const started = !state.error && state.done !== undefined;
  const href = offer.kind === 'prepare' ? `/goals/${offer.goalId}#step-${offer.stepId}` : `/goals/${offer.goalId}`;
  return (
    <li className="card-pad-x row-pad flex flex-wrap items-start gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Link
          href={href}
          className="block text-ui font-semibold break-words text-ink underline-offset-2 hover:underline"
        >
          {offer.title}
        </Link>
        <p className="text-small break-words text-ink-muted">
          {offer.kind === 'prepare'
            ? `Your step in ${offer.goalTitle}. Dash writes a draft, a script or a checklist onto it, and it stays yours.`
            : `${offer.reason} It reads the goal and works its next steps.`}
        </p>
        {state.error && <p className="text-small text-danger">{state.error}</p>}
      </div>
      {started ? (
        <span className="inline-flex items-center gap-1 text-small text-ink-muted" role="status">
          <DashMark state="working" activity="thinking" size="2xs" tone="brand" decorative />
          Dash is on it
        </span>
      ) : (
        <form action={action}>
          <input
            type="hidden"
            name={offer.kind === 'prepare' ? 'id' : 'goalId'}
            value={offer.kind === 'prepare' ? offer.stepId : offer.goalId}
          />
          <Button type="submit" size="sm" variant="secondary" pending={pending}>
            {pending ? 'Starting…' : offer.kind === 'prepare' ? 'Prepare it' : 'Work on it'}
          </Button>
        </form>
      )}
    </li>
  );
}

const ERRAND = 'errand';

function AskDash({
  goals,
  areas,
  defaultAreaId,
}: {
  goals: { id: string; title: string }[];
  areas: { id: string; name: string }[];
  defaultAreaId: string | null;
}) {
  const toast = useToast();
  const errandsOn = areas.length > 0 && defaultAreaId !== null;
  const [target, setTarget] = useState<string>(goals[0]?.id ?? (errandsOn ? ERRAND : ''));
  const [body, setBody] = useState('');
  const [state, ask, asking] = useActionState(async (prev: AskDashState, form: FormData) => {
    const next = await askDashAction(prev, form);
    if (next.done) {
      setBody('');
      toast({ text: next.message ?? 'Asked.' });
    }
    return next;
  }, {} as AskDashState);

  if (!target) return null;
  const errand = target === ERRAND;

  return (
    <form action={ask} className="card-pad-x space-y-2 py-3">
      <label htmlFor="ask-dash" className="block text-small font-semibold text-ink-muted">
        Ask Dash
      </label>
      <ComposeBox>
        <ComposeBody
          id="ask-dash"
          name="body"
          required
          rows={2}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            errand
              ? 'A one-off job, such as find a birthday present for Sam'
              : 'Research, a draft, a plan for the week: anything on this goal'
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-2 pt-1.5">
          <ChipSelect
            name="target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            icon={<Target className="size-3.5" strokeWidth={1.75} />}
            aria-label="What it is for"
          >
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
            {errandsOn && <option value={ERRAND}>A new errand</option>}
          </ChipSelect>
          {errand && (
            <>
              <ChipInput type="date" name="due" icon="Due" required aria-label="The date it is due by" />
              <ChipSelect
                name="areaId"
                defaultValue={defaultAreaId ?? undefined}
                icon={<Folder className="size-3.5" strokeWidth={1.75} />}
                aria-label="Which area it is for"
              >
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </ChipSelect>
            </>
          )}
          {/* An ask on a goal is a reply from Dash; a new errand starts a run, which is not metered here. */}
          {!errand && (
            <PaidHint
              action="app/goals/home-actions.ts#askDashAction"
              what="Cost of Dash's reply"
              align="end"
              className="ml-auto self-center"
            />
          )}
          <Button type="submit" size="sm" className={errand ? 'ml-auto' : undefined} disabled={asking || !body.trim()}>
            {asking ? 'Asking Dash…' : errand ? 'Hand it to Dash' : 'Ask Dash'}
          </Button>
        </div>
      </ComposeBox>
      {state.error && <p className="text-small text-danger">{state.error}</p>}
    </form>
  );
}
