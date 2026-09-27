'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import type { PieceCheck } from '@/lib/learn/lessons/piece-check';
import type { PracticeTable, PracticeView } from '@/lib/learn/lessons/practice';
import type { PieceIdea } from '@/lib/learn/lessons/piece-store';
import {
  answerPieceCheck,
  askPieceCheck,
  handInPractice,
  writeLessonForPiece,
  writePiecePractice,
  type AnswerResult,
  type AskResult,
  type HandInResult,
  type PracticeResult,
} from './actions';

/**
 * A piece's lessons in order, then its practice task, then its check (plans
 * #1141 and #1142).
 *
 * Ideas with no lesson yet are written one after another as the page opens,
 * first idea first, so the top of the page fills while the rest are written.
 * The practice task is written as the page opens too, when the piece has
 * none, and each hand-in is marked point by point. The check is asked for
 * with a press, written then, and marked on Check my answer. The piece passes
 * when both the practice and the check are passed, in either order.
 */

type Writing = { state: 'waiting' | 'writing' } | { state: 'failed'; detail: string };

export function PieceLessons({
  subjectId,
  pieceId,
  ideas: initial,
}: {
  subjectId: string;
  pieceId: string;
  ideas: PieceIdea[];
}) {
  const [ideas, setIdeas] = useState(initial);
  const [writing, setWriting] = useState<Record<string, Writing>>(() =>
    Object.fromEntries(
      initial
        .filter((idea) => !idea.lesson && !idea.dropped)
        .map((idea) => [idea.conceptId, { state: 'waiting' } as Writing]),
    ),
  );
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const missing = initial.filter((idea) => !idea.lesson && !idea.dropped).map((idea) => idea.conceptId);
    if (missing.length === 0) return;
    void (async () => {
      for (const conceptId of missing) {
        setWriting((current) => ({ ...current, [conceptId]: { state: 'writing' } }));
        const result = await writeLessonForPiece(subjectId, pieceId, conceptId).catch(() => ({
          ok: false as const,
          detail: 'Could not reach the server. Reload the page to try again.',
        }));
        if (result.ok) {
          setIdeas((current) => current.map((idea) => (idea.conceptId === conceptId ? result.idea : idea)));
          setWriting((current) => {
            const next = { ...current };
            delete next[conceptId];
            return next;
          });
        } else {
          setWriting((current) => ({ ...current, [conceptId]: { state: 'failed', detail: result.detail } }));
        }
      }
    })();
  }, [initial, pieceId, subjectId]);

  return (
    <ol className="space-y-4">
      {ideas.map((idea, index) => (
        <li key={idea.conceptId}>
          <LessonCard idea={idea} number={index + 1} writing={writing[idea.conceptId] ?? null} />
        </li>
      ))}
    </ol>
  );
}

function LessonCard({ idea, number, writing }: { idea: PieceIdea; number: number; writing: Writing | null }) {
  const { lesson } = idea;
  return (
    <Card padding="standard">
      <p className="text-small text-ink-muted tabular-nums">Lesson {number}</p>
      <h2 className="mt-0.5 font-display text-title tracking-tight break-words text-ink">{idea.name}</h2>

      {lesson ? (
        <>
          <section className="mt-3 rounded-control border-l-2 border-accent bg-accent-tint px-3 py-2.5">
            <h3 className="text-small font-semibold text-accent">The takeaway</h3>
            <p className="mt-1 text-body font-medium text-ink">{lesson.takeaway}</p>
          </section>
          {lesson.context && <p className="mt-3 text-body text-ink">{lesson.context}</p>}
          {lesson.hook && <p className="mt-3 text-body font-semibold text-ink">{lesson.hook}</p>}
          {lesson.summary && <p className="mt-2 text-body text-ink">{lesson.summary}</p>}
          {lesson.example && (
            <section className="mt-4 rounded-control bg-accent-tint px-3 py-2.5">
              <h3 className="text-small font-semibold text-accent">In practice</h3>
              <p className="mt-1 text-body text-ink">{lesson.example}</p>
            </section>
          )}
          {lesson.question && lesson.answer && (
            <section className="mt-4">
              <h3 className="text-small font-semibold text-ink-muted">Try this</h3>
              <p className="mt-1 text-body text-ink">{lesson.question}</p>
              <details className="group mt-2">
                <summary className="press inline-flex cursor-pointer list-none items-center rounded-control text-ui font-medium text-accent [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">Show the answer</span>
                  <span className="hidden group-open:inline">Answer</span>
                </summary>
                <p className="mt-1 text-body text-ink">{lesson.answer}</p>
              </details>
            </section>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-body text-ink">{idea.claim}</p>
          <p className="mt-2 text-small text-ink-muted" aria-live="polite">
            {idea.dropped
              ? `Dash could not write a lesson for this idea: ${idea.dropped}`
              : writing?.state === 'failed'
                ? `The lesson could not be written: ${writing.detail}`
                : writing?.state === 'writing'
                  ? 'Dash is writing this lesson…'
                  : 'Waiting for the lesson before it to be written…'}
          </p>
        </>
      )}
    </Card>
  );
}

/**
 * The practice card and the check card, which share whether each is passed
 * and when the piece was.
 */
export function PiecePassing({
  subjectId,
  pieceId,
  practice,
  check,
  passedAt: initialPassedAt,
  practicePassed: initialPracticePassed,
  checkPassed: initialCheckPassed,
}: {
  subjectId: string;
  pieceId: string;
  practice: PracticeView | null;
  check: PieceCheck | null;
  passedAt: string | null;
  practicePassed: boolean;
  checkPassed: boolean;
}) {
  const router = useRouter();
  const [passedAt, setPassedAt] = useState(initialPassedAt);
  const [practicePassed, setPracticePassed] = useState(initialPracticePassed);
  const [checkPassed, setCheckPassed] = useState(initialCheckPassed);

  const piecePassed = (at: string | undefined) => {
    if (!at || passedAt) return;
    setPassedAt(at);
    // The header and the unit's list of pieces say passed too.
    router.refresh();
  };

  return (
    <>
      <PracticeCard
        subjectId={subjectId}
        pieceId={pieceId}
        practice={practice}
        passedAt={passedAt}
        checkPassed={checkPassed}
        onHandedIn={(result) => {
          if (result.practice?.passed) setPracticePassed(true);
          if (result.checkPassed) setCheckPassed(true);
          piecePassed(result.passedAt);
        }}
      />
      <div className="mt-6">
        <PieceCheckCard
          subjectId={subjectId}
          pieceId={pieceId}
          check={check}
          passedAt={passedAt}
          practicePassed={practicePassed}
          checkPassed={checkPassed}
          onAnswered={(result) => {
            if (result.check?.correct) setCheckPassed(true);
            if (result.practicePassed) setPracticePassed(true);
            piecePassed(result.passedAt);
          }}
        />
      </div>
    </>
  );
}

function PracticeCard({
  subjectId,
  pieceId,
  practice: initialPractice,
  passedAt,
  checkPassed,
  onHandedIn,
}: {
  subjectId: string;
  pieceId: string;
  practice: PracticeView | null;
  passedAt: string | null;
  checkPassed: boolean;
  onHandedIn: (result: HandInResult) => void;
}) {
  const [practice, setPractice] = useState(initialPractice);
  const [answer, setAnswer] = useState(initialPractice?.latest?.answer ?? '');
  const [figures, setFigures] = useState<Record<string, string>>(() =>
    Object.fromEntries((initialPractice?.latest?.figures ?? []).map((figure) => [figure.label, figure.value])),
  );
  const [error, setError] = useState<string | null>(null);
  const [writing, startWriting] = useTransition();
  const [marking, startMarking] = useTransition();
  const started = useRef(false);

  const write = () =>
    startWriting(async () => {
      setError(null);
      const result: PracticeResult = await writePiecePractice(subjectId, pieceId).catch(() => ({
        error: 'Could not write the task. Check your connection.',
      }));
      if (result.practice) setPractice(result.practice);
      else setError(result.error ?? 'Could not write the task.');
    });

  // A piece with no task yet has it written as the page opens.
  useEffect(() => {
    if (started.current || initialPractice) return;
    started.current = true;
    write();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  const handIn = () =>
    startMarking(async () => {
      if (!practice) return;
      setError(null);
      const typed = practice.figures.map((figure) => ({ label: figure.label, value: figures[figure.label] ?? '' }));
      const result: HandInResult = await handInPractice(subjectId, pieceId, practice.id, answer, typed).catch(() => ({
        error: 'Could not mark that. Check your connection.',
      }));
      if (result.practice) {
        setPractice(result.practice);
        onHandedIn(result);
      } else setError(result.error ?? 'Could not mark that.');
    });

  const passed = practice?.passed ?? false;
  const typedSomething = answer.trim() !== '' || Object.values(figures).some((value) => value.trim() !== '');
  const latest = practice?.latest ?? null;

  return (
    <Card padding="standard">
      <h2 className="font-display text-title tracking-tight text-ink">Practice</h2>
      <p className="mt-1 text-ui text-ink-muted">
        {passed
          ? passedAt || checkPassed
            ? 'You have passed the practice.'
            : 'You have passed the practice. Answer the check below to pass the piece.'
          : 'Work this out and hand it in. Dash marks each part, and every part has to be right to pass.'}
      </p>

      {!practice && (
        <div className="mt-3" aria-live="polite">
          {writing ? (
            <p className="text-small text-ink-muted">Dash is writing the task…</p>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Button type="button" variant="primary" onClick={write}>
                Write the task
              </Button>
              <PaidHint action="app/learn/s/[id]/p/[piece]/actions.ts#writePiecePractice" what="Cost of writing the task" />
            </span>
          )}
        </div>
      )}

      {practice && (
        <>
          <p className="mt-3 whitespace-pre-line text-body text-ink">{practice.task}</p>
          {practice.data && <PracticeData table={practice.data} />}
          {practice.spreadsheetNote && (
            <p className="mt-2 text-small text-ink-muted">Typed here rather than in a spreadsheet: {practice.spreadsheetNote}</p>
          )}

          {latest && (
            <section className="mt-4" aria-live="polite">
              <h3 className="text-small font-semibold text-ink-muted">
                {latest.passed ? 'Marked: every part right' : 'Marked: not yet'}
              </h3>
              <ul className="mt-1 space-y-1">
                {latest.marks.map((mark, index) => (
                  <li key={index} className="flex items-start gap-1.5 text-ui">
                    {mark.met ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-ink" strokeWidth={2} aria-label="Right" />
                    ) : (
                      <X className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-label="Missing" />
                    )}
                    <span className={mark.met ? 'text-ink' : 'text-ink-muted'}>{mark.note}</span>
                  </li>
                ))}
              </ul>
              {!latest.passed && (
                <p className="mt-2 text-small text-ink-muted">Fix what is missing and hand it in again.</p>
              )}
            </section>
          )}

          {!passed && (
            <div className="mt-4 space-y-3">
              {practice.figures.map((figure, index) => (
                <Field
                  key={figure.label}
                  id={`practice-figure-${practice.id}-${index}`}
                  label={figure.unit ? `${figure.label} (${figure.unit})` : figure.label}
                >
                  <Input
                    id={`practice-figure-${practice.id}-${index}`}
                    maxLength={200}
                    value={figures[figure.label] ?? ''}
                    onChange={(event) => setFigures((current) => ({ ...current, [figure.label]: event.target.value }))}
                    disabled={marking}
                  />
                </Field>
              ))}
              <Field
                id={`practice-working-${practice.id}`}
                label={practice.figures.length > 0 ? 'Your working' : 'Your answer'}
                hint={practice.figures.length > 0 ? 'How you got there.' : 'Type it as lines of text.'}
              >
                <Textarea
                  id={`practice-working-${practice.id}`}
                  rows={5}
                  maxLength={4000}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  disabled={marking}
                />
              </Field>
              <span className="inline-flex items-center gap-1">
                <Button type="button" variant="primary" onClick={handIn} pending={marking} disabled={!typedSomething}>
                  {marking ? 'Marking…' : 'Hand it in'}
                </Button>
                <PaidHint action="app/learn/s/[id]/p/[piece]/actions.ts#handInPractice" what="Cost of marking what you hand in" />
              </span>
            </div>
          )}

          {passed && practice.worked && (
            <details className="group mt-4">
              <summary className="press inline-flex cursor-pointer list-none items-center rounded-control text-ui font-medium text-accent [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Show a worked answer</span>
                <span className="hidden group-open:inline">A worked answer</span>
              </summary>
              <p className="mt-1 whitespace-pre-line text-body text-ink">{practice.worked}</p>
            </details>
          )}
        </>
      )}

      {error && <p className="mt-2 text-small text-danger">{error}</p>}
    </Card>
  );
}

const NUMBER_LIKE = /^[-+(]?[$£€]?[\d.,]+%?[)]?[kmb]?$/i;

function PracticeData({ table }: { table: PracticeTable }) {
  const numeric = table.columns.map((_, index) =>
    table.rows.every((row) => row[index] === '' || NUMBER_LIKE.test(row[index].replace(/\s/g, ''))),
  );
  return (
    <div className="mt-3">
      <Table stack={false} flush>
        <THead>
          <tr>
            {table.columns.map((column, index) => (
              <TH key={index} num={index > 0 && numeric[index]}>
                {column}
              </TH>
            ))}
          </tr>
        </THead>
        <TBody>
          {table.rows.map((row, rowIndex) => (
            <TR key={rowIndex}>
              {row.map((cell, index) => (
                <TD key={index} num={index > 0 && numeric[index]}>
                  {cell}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function PieceCheckCard({
  subjectId,
  pieceId,
  check: initialCheck,
  passedAt,
  practicePassed,
  checkPassed,
  onAnswered,
}: {
  subjectId: string;
  pieceId: string;
  check: PieceCheck | null;
  passedAt: string | null;
  practicePassed: boolean;
  checkPassed: boolean;
  onAnswered: (result: AnswerResult) => void;
}) {
  const [check, setCheck] = useState(initialCheck);
  const [tested, setTested] = useState<number | null>(null);
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asking, startAsking] = useTransition();
  const [marking, startMarking] = useTransition();

  const ask = () =>
    startAsking(async () => {
      setError(null);
      const result: AskResult = await askPieceCheck(subjectId, pieceId).catch(() => ({
        error: 'Could not write a question. Check your connection.',
      }));
      if (result.check) {
        setCheck(result.check);
        setResponse('');
      } else setError(result.error ?? 'Could not write a question.');
    });

  const answer = () =>
    startMarking(async () => {
      if (!check) return;
      setError(null);
      const result: AnswerResult = await answerPieceCheck(subjectId, pieceId, check.id, response).catch(() => ({
        error: 'Could not mark that. Check your connection.',
      }));
      if (result.check) {
        setCheck(result.check);
        if (result.tested !== undefined) setTested(result.tested);
        onAnswered(result);
      } else setError(result.error ?? 'Could not mark that.');
    });

  const answered = check !== null && check.correct !== null;
  const canAsk = !checkPassed && (check === null || check.correct === false);

  return (
    <Card padding="standard">
      <h2 className="font-display text-title tracking-tight text-ink">Check</h2>
      <p className="mt-1 text-ui text-ink-muted">
        {passedAt
          ? 'You have passed this piece.'
          : checkPassed
            ? 'You have answered the check right. Pass the practice above to pass the piece.'
            : practicePassed
              ? 'One question needing this piece’s ideas together, answered from memory. A right answer passes the piece.'
              : 'One question needing this piece’s ideas together, answered from memory. The piece passes when this and the practice are both right.'}
      </p>

      {check && (
        <p className="mt-3 text-body text-ink" aria-live="polite">
          {check.question}
        </p>
      )}

      {check && !answered && (
        <>
          <Field label="Your answer" id={`piece-check-${check.id}`} hint="A sentence or two, from memory.">
            <Textarea
              id={`piece-check-${check.id}`}
              rows={3}
              maxLength={2000}
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              disabled={marking}
            />
          </Field>
          <span className="mt-3 inline-flex items-center gap-1">
            <Button type="button" variant="primary" onClick={answer} pending={marking} disabled={response.trim() === ''}>
              {marking ? 'Marking…' : 'Check my answer'}
            </Button>
            <PaidHint action="app/learn/s/[id]/p/[piece]/actions.ts#answerPieceCheck" what="Cost of marking the answer" />
          </span>
        </>
      )}

      {check && answered && (
        <div className="mt-3 space-y-2" aria-live="polite">
          {check.response && <p className="text-ui text-ink-muted">You wrote: {check.response}</p>}
          <p className={cn('flex items-center gap-1.5 text-ui font-medium', check.correct ? 'text-ink' : 'text-ink-muted')}>
            {check.correct ? (
              <Check className="size-4" strokeWidth={2} aria-hidden />
            ) : (
              <X className="size-4" strokeWidth={2} aria-hidden />
            )}
            {check.correct ? 'Right.' : 'Not yet.'}
          </p>
          {check.why && <p className="text-ui text-ink">{check.why}</p>}
          {check.expected && <p className="text-ui text-ink-muted">Expected: {check.expected}</p>}
          {check.correct && tested !== null && (
            <p className="text-small text-ink-muted">
              {passedAt ? 'Piece passed. ' : ''}
              {tested === 1 ? 'Its one idea is' : `Its ${tested} ideas are`} now marked tested.
            </p>
          )}
        </div>
      )}

      {canAsk && (
        <span className="mt-3 inline-flex items-center gap-1">
          <Button type="button" variant={check ? 'secondary' : 'primary'} onClick={ask} pending={asking}>
            {asking ? 'Writing a question…' : check ? 'Try another question' : 'Ask me the question'}
          </Button>
          <PaidHint action="app/learn/s/[id]/p/[piece]/actions.ts#askPieceCheck" what="Cost of writing the question" />
        </span>
      )}

      {error && <p className="mt-2 text-small text-danger">{error}</p>}
    </Card>
  );
}
