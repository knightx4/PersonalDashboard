'use client';

import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { InlineTextarea, Textarea } from '@/components/ui/field';
import { DashAction } from '@/components/ui/dash-action';
import {
  DIG_KINDS,
  DIG_LABELS,
  editedPoint,
  editedPointNote,
  ROLE_LABELS,
  type DigKind,
  type PlanPoint,
  type Stage,
} from '@/lib/learn/essays/plan';
import { answerEssayPoint, askEssayPoint } from './guide-actions';
import { NextStage, type PlanApi } from './essay-stages';
import { lowerFirst } from './essay-plan';
import { ArgumentMapCard, PointEvidenceCard } from './essay-evidence';

const ASK_ACTION = 'app/learn/e/[id]/guide-actions.ts#askEssayPoint';
const ANSWER_ACTION = 'app/learn/e/[id]/guide-actions.ts#answerEssayPoint';

/**
 * Develop (LEARN-ESSAYS-SPEC, "The stages"): each point dug into, one
 * question at a time. The person picks a point; Dash asks one question about
 * it (why it is true, an example, what shows it, what a doubter says, why the
 * reader cares, how it connects), building on what they have said so far.
 * Their answer is kept under the point in their words and Dash asks the next,
 * until they say they have enough. They can steer it by picking the kind of
 * question themselves. The answers are their notes for writing that part.
 */
export function DevelopStage({
  essayId,
  api,
  onStage,
  done,
}: {
  essayId: string;
  api: PlanApi;
  onStage: (stage: Stage) => void;
  done: boolean;
}) {
  const points = api.plan.points.filter((p) => p.text.trim());
  const [chosen, setChosen] = useState<string | null>(
    () => points.find((p) => !p.ready && p.notes.length < 2)?.id ?? points[0]?.id ?? null,
  );
  const point = points.find((p) => p.id === chosen) ?? points[0] ?? null;

  if (points.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Card padding="standard">
          <p className="text-ui text-ink-muted">
            Your points appear here once you have written some on the Plan step. Each one then gets
            its own questions.
          </p>
        </Card>
        <NextStage stage="develop" onStage={onStage} ready={false} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ArgumentMapCard plan={api.plan} chosen={point?.id ?? null} onChoose={setChosen} />

      {point && <PointWork key={point.id} essayId={essayId} point={point} api={api} />}
      {point && (
        <PointEvidenceCard key={`e:${point.id}`} essayId={essayId} point={point} api={api} />
      )}

      <NextStage
        stage="develop"
        onStage={onStage}
        ready={done}
        hint="Two or three answers under each point and you are ready to write. You can come back here any time."
      />
    </div>
  );
}

/** One point: its notes so far, the question being asked, and the box for the answer. */
function PointWork({ essayId, point, api }: { essayId: string; point: PlanPoint; api: PlanApi }) {
  const answerId = useId();
  const [answer, setAnswer] = useState('');
  const [asking, startAsk] = useTransition();
  const [answering, startAnswer] = useTransition();
  const [stopping, startStop] = useTransition();
  const busy = asking || answering || stopping;

  const ask = (kind: DigKind | null) =>
    startAsk(async () => {
      await api.run(() => askEssayPoint(essayId, point.id, kind));
    });

  const send = (more: boolean) =>
    (more ? startAnswer : startStop)(async () => {
      const ok = await api.run(() => answerEssayPoint(essayId, point.id, answer, more));
      if (ok) setAnswer('');
    });

  return (
    <Card padding="none" aria-busy={busy || undefined}>
      <CardSection
        title={point.text.trim()}
        hint={
          point.guide
            ? `${ROLE_LABELS[point.role]} · what this part does: ${lowerFirst(point.guide)}`
            : ROLE_LABELS[point.role]
        }
      >
        {point.notes.length === 0 && !point.asking && (
          <p className="text-ui text-ink-muted">
            Dash asks you about this point one question at a time, building on your answers. What
            you write is kept here as your notes for this part.
          </p>
        )}
        {point.notes.length > 0 && (
          <ol className="flex flex-col divide-y divide-border">
            {point.notes.map((note, i) => (
              <NoteRow
                key={`${i}:${note.ask}`}
                ask={note.ask}
                answer={note.answer}
                onEdit={(text) =>
                  api.change({ kind: 'note', point: point.id, index: i, text }, (now) =>
                    editedPointNote(now, point.id, i, text),
                  )
                }
              />
            ))}
          </ol>
        )}
      </CardSection>

      {point.asking ? (
        <CardSection title="Dash asks">
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && answer.trim()) send(true);
            }}
          >
            <p id={`${answerId}-ask`} className="text-body font-medium text-ink" aria-live="polite">
              {point.asking.ask}
            </p>
            <Textarea
              id={answerId}
              rows={3}
              autoFocus
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Rough notes, in your own words"
              aria-labelledby={`${answerId}-ask`}
              disabled={busy}
            />
            <div className="flex flex-wrap items-center gap-2">
              <DashAction
                type="submit"
                size="sm"
                pending={answering}
                disabled={busy || !answer.trim()}
                paid={ANSWER_ACTION}
                what="Cost of the next question"
              >
                {answering ? 'Keeping it…' : 'Answer and ask me more'}
              </DashAction>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                pending={stopping}
                disabled={busy || !answer.trim()}
                onClick={() => send(false)}
              >
                Answer and stop here
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => ask(null)}
              >
                Skip this question
              </Button>
            </div>
          </form>
        </CardSection>
      ) : (
        <CardSection title={point.notes.length ? 'Keep going' : 'Start'}>
          <div className="flex flex-wrap items-center gap-2">
            <DashAction
              type="button"
              size="sm"
              pending={asking}
              disabled={busy}
              onClick={() => ask(null)}
              paid={ASK_ACTION}
              what="Cost of one question"
            >
              {asking
                ? 'Asking…'
                : point.notes.length
                  ? 'Ask me another question'
                  : 'Ask me about this point'}
            </DashAction>
            <Button
              type="button"
              size="sm"
              variant={point.ready ? 'secondary' : 'ghost'}
              pressed={point.ready}
              onClick={() =>
                api.change({ kind: 'edit', point: point.id, ready: !point.ready }, (now) =>
                  editedPoint(now, point.id, { ready: !point.ready }),
                )
              }
            >
              {point.ready ? 'Ready to write' : 'I have enough to write this'}
            </Button>
          </div>
        </CardSection>
      )}

      <CardSection title="Or ask about" hint="Steer the next question yourself.">
        <div className="flex flex-wrap gap-1.5">
          {DIG_KINDS.map((kind) => (
            <Button
              key={kind}
              type="button"
              size="xs"
              variant="secondary"
              pressed={point.asking?.kind === kind}
              disabled={busy}
              onClick={() => ask(kind)}
            >
              {DIG_LABELS[kind]}
            </Button>
          ))}
        </div>
      </CardSection>
      {api.error && (
        <p role="alert" className="px-4 pb-3 text-small text-danger">
          {api.error}
        </p>
      )}
    </Card>
  );
}

function NoteRow({
  ask,
  answer,
  onEdit,
}: {
  ask: string;
  answer: string;
  onEdit: (text: string) => void;
}) {
  const id = useId();
  return (
    <li className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
      <label htmlFor={id} className="text-small text-ink-muted">
        Dash: {ask}
      </label>
      <InlineTextarea
        id={id}
        defaultValue={answer}
        onBlur={(event) => {
          if (event.currentTarget.value.trim() !== answer.trim()) onEdit(event.currentTarget.value);
        }}
        className="min-h-11 lg:min-h-0 -mx-1 text-ui text-ink"
      />
    </li>
  );
}
