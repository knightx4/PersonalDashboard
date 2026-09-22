'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { KindBadge } from '@/components/learn/kind-badge';
import { MasteryChecks } from '@/components/learn/mastery-checks';
import { ProbeOptions } from '@/components/learn/probe-options';
import { WrittenAnswer } from '@/components/learn/written-answer';
import {
  answerQuestion,
  approveFloor,
  askQuestion,
  findFloor,
  markKnown,
  type AskState,
  type DeclareState,
  type FloorState,
} from './actions';

/**
 * One question at a time, and the truth about how far along you are.
 *
 * The bar measures information gained rather than questions answered, so it
 * moves a long way early and barely at all later, and it never reaches 100%.
 * That is the honest shape: nothing here can establish that somebody knows a
 * subject, and a bar that filled would be saying it had.
 *
 * The reason is shown after answering, never before, and it was written at the
 * same time as the question rather than generated in response to what was
 * picked -- which is what stops it being an explanation of the answer somebody
 * happened to give.
 */

function Bar({ percent }: { percent: number }) {
  return (
    <div className="mb-5">
      <div
        className="h-1.5 w-full overflow-hidden rounded-pill bg-sunken"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="How much this has learned about you"
      >
        <div className="h-full rounded-pill bg-accent transition-all" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-small text-ink-muted">
        {percent === 0
          ? 'Nothing answered yet.'
          : `${percent}% of what this can find out — it measures what has been learned about you, not how many questions you have answered.`}
      </p>
    </div>
  );
}

function AskButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? 'Writing a question…' : label}
    </Button>
  );
}

/**
 * The way out of a case about something you are already sure of.
 *
 * It submits the same form to a different action, which is why it carries
 * `formAction` and turns the browser's validation off: the answer box is
 * required for the answer and there is nothing to type here. The concept is
 * marked known on your word, and the case is left unanswered.
 */
function KnownButton({ declare }: { declare: (formData: FormData) => void }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" formAction={declare} formNoValidate disabled={pending}>
      I already know this
    </Button>
  );
}

/**
 * What a missed claim rests on, offered rather than added.
 *
 * Getting something wrong when the graph has nothing underneath is a fact
 * about the graph before it is a fact about the person: there is nothing to
 * fall back to, which means the chain was drawn starting too high. The
 * approval matters more here than anywhere else in the module, because this is
 * generated at the moment somebody is least inclined to argue with a machine
 * telling them what they are missing.
 */
function Floor({ subjectId, conceptId }: { subjectId: string; conceptId: string }) {
  const [state, find] = useActionState<FloorState, FormData>(findFloor, {});
  const [saved, approve] = useActionState<FloorState, FormData>(approveFloor, {});

  if (saved.message) {
    return <p className="mt-3 text-ui text-ink-muted">{saved.message}</p>;
  }

  if (state.chain) {
    const added = state.chain.nodes.filter((node) => !node.existingId);

    return (
      <form action={approve} className="mt-4 border-t border-border pt-4">
        <input type="hidden" name="subjectId" value={subjectId} />
        <input type="hidden" name="chain" value={JSON.stringify(state.chain)} />

        <p className="text-ui text-ink-muted">
          {added.length === 0
            ? 'Nothing new — this rests on things your graph already has, and the edges were missing rather than the nodes.'
            : `This rests on ${added.length === 1 ? 'one thing' : `${added.length} things`} your graph did not have. Nothing is saved until you approve it.`}
        </p>

        <ul className="mt-2 space-y-2">
          {state.chain.nodes
            .filter((node) => !node.existingId)
            .map((node) => (
              <li key={node.name}>
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-ui font-medium text-ink">{node.name}</span>
                  <KindBadge kind={node.kind} />
                </span>
                <span className="block text-ui text-ink">{node.claim}</span>
                <span className="block text-small text-ink-muted">{node.basis}</span>
                <MasteryChecks checks={node.mastery} className="mt-1" />
              </li>
            ))}
        </ul>

        <div className="mt-3 flex items-center gap-3">
          <Button type="submit" variant="secondary">
            Add these underneath
          </Button>
          {saved.error && <span className="text-ui text-danger">{saved.error}</span>}
        </div>
      </form>
    );
  }

  return (
    <form action={find} className="mt-4 border-t border-border pt-4">
      <input type="hidden" name="subjectId" value={subjectId} />
      <input type="hidden" name="conceptId" value={conceptId} />
      <p className="text-small text-ink-muted">
        Nothing sits under this one in your graph, so there is nothing to fall back to. That is
        usually the graph starting too high rather than anything about you.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="ghost">
          Work out what it rests on
        </Button>
        {state.message && <span className="text-ui text-ink-muted">{state.message}</span>}
        {state.error && <span className="text-ui text-danger">{state.error}</span>}
      </div>
    </form>
  );
}

export function ProbeSession({
  subjectId,
  startingPercent,
  startConceptId = null,
  startConceptName = null,
}: {
  subjectId: string;
  startingPercent: number;
  /** Named by the row on /learn/next. Carried by the first question only. */
  startConceptId?: string | null;
  startConceptName?: string | null;
}) {
  const [state, ask] = useActionState<AskState, FormData>(askQuestion, { percent: startingPercent });
  const [answerState, answer] = useActionState<AskState, FormData>(answerQuestion, state);
  const [declared, declare] = useActionState<DeclareState, FormData>(markKnown, {});

  // The answer action carries the question forward, so whichever ran last is
  // the live one. An answer that could not be graded counts: the question is
  // still on screen and the reason it was not graded belongs under it.
  const live = answerState.answered || answerState.error ? answerState : state;
  const percent = live.percent ?? startingPercent;
  // Keyed on the question rather than on a flag, so asking for another one
  // brings the answer box back instead of leaving the last wave-through on
  // screen. The bar is not read from here: nothing was answered, so nothing
  // moved it.
  const waved = declared.probeId !== undefined && declared.probeId === live.probeId;

  return (
    <>
      <Bar percent={percent} />

      {live.question ? (
        <div className={cardVariants({ padding: 'standard' })}>
          <p className="text-small text-ink-muted">{live.conceptName}</p>
          {/* The case, on the applied rung. Read first, then the thing to say
              about it, which is why they are two paragraphs rather than one. */}
          {live.situation && <p className="mt-1 text-body text-ink">{live.situation}</p>}
          <p className="mt-1 text-body text-ink">{live.question}</p>

          {!waved && (
            <form action={answer} className="mt-4 space-y-2">
              <input type="hidden" name="probeId" value={live.probeId} />
              <input type="hidden" name="conceptId" value={live.conceptId} />
              <input type="hidden" name="subjectId" value={subjectId} />

              {live.options ? (
                <ProbeOptions options={live.options} answered={live.answered ?? null} />
              ) : (
                <WrittenAnswer
                  response={live.answered?.response ?? null}
                  beside={live.answered ? undefined : <KnownButton declare={declare} />}
                />
              )}
            </form>
          )}

          {waved && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-body text-ink">
                Marked as known. Nothing was answered here, so it shows as “you said so” wherever
                the state appears, with no date on it.
              </p>

              <form action={ask} className="mt-4">
                <input type="hidden" name="subjectId" value={subjectId} />
                <AskButton label="Another one" />
              </form>
            </div>
          )}

          {live.answered && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-ui font-semibold text-ink">
                {live.answered.correct ? 'Right.' : 'Not this time.'}
              </p>
              {/* Written when the question was, not in response to what was
                  picked. That is what makes it worth reading. On the applied
                  rung it is the grader's sentence about what was typed, and
                  the answer the case was written with is below it. */}
              <p className="mt-1 text-body text-ink">{live.answered.reason}</p>

              {live.answered.expected && (
                <>
                  <p className="mt-3 text-small text-ink-muted">The answer expected</p>
                  <p className="mt-0.5 text-body text-ink">{live.answered.expected}</p>
                </>
              )}

              {!live.answered.correct && live.answered.weight === 0 && (
                // A part of the idea you had already missed. Said out loud,
                // because a bar that sits still after an honest answer reads
                // as broken rather than as the rule working.
                <p className="mt-3 text-ui text-ink-muted">
                  The bar did not move: you had already missed this part of the idea, and getting
                  it wrong again says nothing the first time did not.
                </p>
              )}

              {live.answered.misconception && (
                // The same wrong answer twice. Said plainly, because a gap and
                // a thing steering you wrong are different problems and only
                // one of them is fixed by reading more.
                <p className="mt-3 border-l-2 border-danger pl-3 text-body text-ink">
                  You have picked this one twice now. {live.answered.misconception}
                </p>
              )}

              {live.answered.couldGoDeeper && live.conceptId && (
                <Floor subjectId={subjectId} conceptId={live.conceptId} />
              )}

              <form action={ask} className="mt-4">
                <input type="hidden" name="subjectId" value={subjectId} />
                <AskButton label="Another one" />
              </form>
            </div>
          )}

          {live.error && <p className="mt-3 text-ui text-danger">{live.error}</p>}
          {declared.error && <p className="mt-3 text-ui text-danger">{declared.error}</p>}
        </div>
      ) : (
        <form action={ask} className={cn(cardVariants(), 'border-dashed px-4 py-6 text-center')}>
          <input type="hidden" name="subjectId" value={subjectId} />
          {/* Only here, and deliberately: the form that asks for another
              question carries no concept, so the session picks for itself from
              the second question on. */}
          {startConceptId && <input type="hidden" name="conceptId" value={startConceptId} />}
          <p className="text-body text-ink-muted">
            {startConceptName
              ? `The first question is about ${startConceptName}. After that, one at a time against whatever this track has least evidence on.`
              : 'One question at a time, written against one idea in this track. Ten is a good start, and then as many as you want.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <AskButton label="Start" />
            {live.error && <span className="text-ui text-danger">{live.error}</span>}
          </div>
        </form>
      )}
    </>
  );
}
