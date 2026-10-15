'use client';

import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { InlineTextarea } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import { BRIEF_FIELDS, type EssayBrief, type EssayInterview } from '@/lib/learn/essays/model';
import type { Stage } from '@/lib/learn/essays/plan';
import { saveEssayBriefField } from './actions';
import { readEssayBrief } from './guide-actions';
import { BriefLine } from './essay-brief';
import { NextStage, type PlanApi } from './essay-stages';

const READ_ACTION = 'app/learn/e/[id]/guide-actions.ts#readEssayBrief';

/**
 * Discover, once the interview is done or skipped (LEARN-ESSAYS-SPEC, "The
 * stages"): the brief open, every answer editable where it is read, and
 * under it Dash's read of it. Each of Dash's notes ends in a question and has
 * a line for the person's reply; Read it again sends the brief with those
 * replies, so the next read moves on from what they settled. A sharper
 * question can be taken as the essay's question with one press, and edited
 * after like any answer.
 */
export function DiscoverStage({
  essayId,
  brief,
  onBrief,
  api,
  onStage,
  done,
}: {
  essayId: string;
  brief: EssayBrief;
  onBrief: (brief: EssayBrief, interview: EssayInterview | null) => void;
  api: PlanApi;
  onStage: (stage: Stage) => void;
  done: boolean;
}) {
  const [reading, startRead] = useTransition();
  const [using, setUsing] = useState<string | null>(null);
  const [useError, setUseError] = useState<string | null>(null);
  const readback = api.plan.readback;

  const readAgain = () =>
    startRead(async () => {
      await api.run(() => readEssayBrief(essayId));
    });

  const takeQuestion = async (question: string) => {
    setUsing(question);
    setUseError(null);
    const result = await saveEssayBriefField(essayId, 'question', question).catch(() => undefined);
    setUsing(null);
    if (!result || !result.ok) {
      setUseError(
        result && !result.ok ? result.error : 'The connection dropped. Try again in a moment.',
      );
      return;
    }
    onBrief(result.brief, result.interview);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card padding="none">
        <CardSection
          title="Your brief"
          hint="Your answers from the interview. Change any of them here."
        >
          {/* Remounted when a sharper question is taken, so the line shows it. */}
          <div className="flex flex-col gap-3" key={brief.question}>
            {BRIEF_FIELDS.map((field) => (
              <BriefLine
                key={field}
                essayId={essayId}
                field={field}
                value={brief[field]}
                onChange={onBrief}
              />
            ))}
          </div>
        </CardSection>
      </Card>

      <Card padding="none" aria-busy={reading || undefined}>
        <CardSection
          title="Dash’s read"
          hint="Where your thinking is still loose. Reply in your own words, or change your answers above."
          action={
            <span className="flex items-center gap-1">
              <PaidHint action={READ_ACTION} what="Cost of Dash reading your brief" />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                pending={reading}
                disabled={reading}
                onClick={readAgain}
              >
                {reading ? 'Reading…' : readback ? 'Read it again' : 'Have Dash read it'}
              </Button>
            </span>
          }
        >
          {!readback && !reading && (
            <p className="text-ui text-ink-muted">
              Dash reads your five answers and points out where the question is too broad, where
              your answer is really several claims, or what nothing would change your mind about.
            </p>
          )}
          {reading && !readback && <p className="text-ui text-ink-muted">Reading your answers…</p>}
          {readback && readback.notes.length > 0 && (
            <ol className="flex flex-col divide-y divide-border">
              {readback.notes.map((note, i) => (
                <ReadbackNote
                  key={`${readback.at}:${i}`}
                  body={note.body}
                  reply={note.reply}
                  onReply={(text) => api.change({ kind: 'reply', index: i, text })}
                />
              ))}
            </ol>
          )}
          {readback && readback.notes.length === 0 && (
            <p className="text-ui text-ink-muted">
              Dash had nothing more to raise about your answers.
            </p>
          )}
        </CardSection>
        {readback && readback.sharper.length > 0 && (
          <CardSection
            title="Sharper versions of your question"
            hint="Narrower questions a reader could disagree about. Take one and make it yours, or keep your own."
          >
            <ul className="flex flex-col divide-y divide-border">
              {readback.sharper.map((question) => (
                <li
                  key={question}
                  className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <p className="min-w-0 text-ui text-ink">{question}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    pending={using === question}
                    disabled={using !== null || question === brief.question.trim()}
                    onClick={() => void takeQuestion(question)}
                  >
                    {question === brief.question.trim() ? 'Your question' : 'Use this'}
                  </Button>
                </li>
              ))}
            </ul>
            {useError && (
              <p role="alert" className="mt-2 text-small text-danger">
                {useError}
              </p>
            )}
          </CardSection>
        )}
        {api.error && (
          <p role="alert" className="px-4 pb-3 text-small text-danger">
            {api.error}
          </p>
        )}
      </Card>

      <NextStage
        stage="discover"
        onStage={onStage}
        ready={done}
        hint="Research works best once you have a question and a first answer."
      />
    </div>
  );
}

function ReadbackNote({
  body,
  reply,
  onReply,
}: {
  body: string;
  reply: string;
  onReply: (text: string) => void;
}) {
  const id = useId();
  return (
    <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <p className="text-ui text-ink">
        <span className="font-medium">Dash: </span>
        {body}
      </p>
      <label htmlFor={id} className="sr-only">
        Your reply
      </label>
      <InlineTextarea
        id={id}
        defaultValue={reply}
        placeholder="Your reply, in a line or two"
        onBlur={(event) => {
          if (event.currentTarget.value.trim() !== reply.trim()) onReply(event.currentTarget.value);
        }}
        className="min-h-11 lg:min-h-0 -mx-1 text-ink"
      />
    </li>
  );
}
