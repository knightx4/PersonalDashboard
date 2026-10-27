'use client';

import { useCallback, useState, useTransition } from 'react';
import { PageHeader, type Subject } from '@/components/shell/page-header';
import { Property } from '@/components/shell/detail-layout';
import { DetailFacts, DetailPage } from '@/components/patterns/list-detail';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Check, Clock, Minus, X } from 'lucide-react';
import { DashMark } from '@/components/ui/dash-mark';
import { SectionFold } from '@/components/ui/disclosure';
import { Checkbox, FieldError, Label, Textarea } from '@/components/ui/field';
import Link, { linkVariants } from '@/components/ui/link';
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/cn';
import { whenWeekday } from '@/lib/core/when';
import { formatDateTime } from '@/lib/jobs/applications/load';
import {
  heldOnLabel,
  meetingState,
  meetingTitle,
  progress,
  SEAT_LABELS,
  SEAT_NAMES,
  type BoardDisagreement,
  type BoardMark,
  type BoardMeeting,
  type BoardMinutes,
  type BoardResolution,
  type BoardScore,
  type Grade,
  type MarkKind,
  type VoteValue,
} from '@/lib/you/board';
import { NO_DEBATE, type MeetingDebate } from '@/lib/you/board-debate';
import {
  answerBoardQuestion,
  makeResolutionTodo,
  markResolution,
  voteOnDisagreement,
  type BoardMarkResult,
} from '../actions';
import { useRefreshWhileRunning } from '../refresh-while-running';
import { SeatLabel } from '../seat-label';
import { AdvisorDrawer, QuestionDebate } from './debate';
import { Evidence, Prose } from './prose';

/**
 * One board meeting (plan #2540.3), on the detail pattern
 * (components/patterns/list-detail.tsx): the header, the facts, the
 * minutes' opening, then the rest of the minutes in the order the board
 * skill writes them. The person votes on each disagreement, answers the
 * question, and ticks each resolution or makes it a todo here; every mark
 * saves as it is made. The scorecard counts every meeting, and the memos sit
 * folded at the foot.
 *
 * A meeting still being held shows that it is, with when it started, and the
 * page looks again every minute; one that failed shows its error and when it
 * was asked for.
 *
 * A meeting held as a debate (plan #2561.5) took up questions, and shows each
 * one's scores and rounds (debate.tsx) in place of the disagreements, with
 * the turns that have landed while it is still being held. A meeting written
 * in the old minutes form took up none and keeps the view above.
 */

export type MeetingActions = {
  vote: (
    id: string,
    item: string,
    value: VoteValue,
    note?: string | null,
  ) => Promise<BoardMarkResult>;
  answer: (id: string, answer: string) => Promise<BoardMarkResult>;
  tick: (id: string, item: string, done: boolean) => Promise<BoardMarkResult>;
  makeTodo: (id: string, item: string) => Promise<BoardMarkResult>;
};

const REAL_ACTIONS: MeetingActions = {
  vote: voteOnDisagreement,
  answer: answerBoardQuestion,
  tick: markResolution,
  makeTodo: makeResolutionTodo,
};

/** For the gallery: draw a hidden part open, the memos or one advisor's thinking by id. */
export type MeetingOpen = { memos?: boolean; advisor?: string };

const GRADE_LABELS: Record<Grade, string> = {
  hit: 'Hit',
  miss: 'Miss',
  cant_tell: 'Can’t tell',
  pending: 'Not graded yet',
};

const GRADE_GLYPHS: Record<Grade, typeof Check> = {
  hit: Check,
  miss: X,
  cant_tell: Minus,
  pending: Clock,
};

/** A grade in ink, told apart by its glyph and its word rather than by colour. */
function GradeMark({ grade }: { grade: Grade }) {
  const Glyph = GRADE_GLYPHS[grade];
  return (
    <span className="inline-flex items-center gap-1 text-small font-medium text-ink">
      <Glyph aria-hidden className="size-3.5" strokeWidth={1.75} />
      {GRADE_LABELS[grade]}
    </span>
  );
}

const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

const markKey = (kind: MarkKind, item: string) => `${kind}:${item}`;

/** "Mon 26 Oct", for a resolution's day. */
function dayLabel(day: string): string {
  return `${whenWeekday(day, { timeZone: 'UTC', style: 'short' })} ${heldOnLabel(day).replace(/ \d{4}$/, '')}`;
}

export function MeetingView({
  meeting,
  minutes,
  marks: initialMarks,
  debate = NO_DEBATE,
  scorecard,
  subject,
  timezone = 'UTC',
  now,
  actions = REAL_ACTIONS,
  open = {},
}: {
  meeting: BoardMeeting;
  minutes: BoardMinutes;
  marks: readonly BoardMark[];
  /** The questions the meeting took up and every turn on them; empty for the old minutes form. */
  debate?: MeetingDebate;
  /** Each seat's hits and misses across every meeting (scorecardFrom). */
  scorecard: readonly BoardScore[];
  subject: Subject;
  timezone?: string;
  /** When the page was read, for whether a meeting is still running. */
  now: number;
  actions?: MeetingActions;
  open?: MeetingOpen;
}) {
  const [marks, setMarks] = useState<ReadonlyMap<string, BoardMark>>(
    () => new Map(initialMarks.map((mark) => [markKey(mark.kind, mark.item), mark])),
  );
  const state = meetingState(meeting, now);
  useRefreshWhileRunning(state.kind === 'running');
  const [advisorId, setAdvisorId] = useState<string | null>(open.advisor ?? null);
  const closeAdvisor = useCallback(() => setAdvisorId(null), []);
  const shownAdvisor = advisorId ? debate.advisors.find((a) => a.id === advisorId) : undefined;
  const isDebate = debate.questions.length > 0;
  const questions = debate.questions.map((question, index) => (
    <QuestionDebate
      key={question.id}
      question={question}
      number={index + 1}
      of={debate.questions.length}
      advisors={debate.advisors}
      running={state.kind === 'running'}
      onOpen={setAdvisorId}
    />
  ));
  const drawer = shownAdvisor && (
    <AdvisorDrawer advisor={shownAdvisor} debate={debate} onClose={closeAdvisor} />
  );

  const keep = (kind: MarkKind, item: string, saved: BoardMark | null | undefined) =>
    setMarks((current) => {
      const next = new Map(current);
      if (saved) next.set(markKey(kind, item), saved);
      else next.delete(markKey(kind, item));
      return next;
    });
  const markOf = (kind: MarkKind, item: string | null) =>
    item ? marks.get(markKey(kind, item)) : undefined;

  const title = meetingTitle(meeting);
  const counts = progress(minutes, [...marks.values()]);
  const ready = state.kind === 'ready';

  const details = (
    <DetailFacts>
      <Property label="Held" value={meeting.heldOn ? heldOnLabel(meeting.heldOn) : 'Not yet'} />
      <Property label="Kind" value={meeting.kind === 'called' ? 'Called' : 'Weekly'} />
      {ready && isDebate ? (
        <>
          <Property label="Questions" value={String(debate.questions.length)} />
          <Property label="Advisors" value={String(debate.advisors.length)} />
        </>
      ) : ready ? (
        <>
          <Property
            label="Your votes"
            value={
              counts.disagreements ? `${counts.voted} of ${counts.disagreements}` : 'None to cast'
            }
          />
          <Property
            label="Resolutions done"
            value={counts.resolutions ? `${counts.done} of ${counts.resolutions}` : 'None proposed'}
          />
        </>
      ) : (
        <Property
          label="Asked for"
          value={formatDateTime(meeting.requestedAt, timezone, now)}
          wide
        />
      )}
    </DetailFacts>
  );

  if (state.kind === 'running') {
    return (
      <DetailPage header={<PageHeader title={title} subject={subject} />} details={details}>
        <Card padding="standard" className="flex items-start gap-2.5" role="status">
          <DashMark state="working" activity="reading" decorative className="mt-0.5" />
          <p className="text-body text-ink">
            The board is meeting, started {formatDateTime(state.since, timezone, now)}. This page
            fills in with the minutes when it is done.
            {meeting.runUrl && (
              <>
                {' '}
                <a
                  href={meeting.runUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={linkVariants({ tone: 'quiet' })}
                >
                  Watch the meeting
                </a>
              </>
            )}
          </p>
        </Card>
        {questions}
        {drawer}
      </DetailPage>
    );
  }

  if (state.kind === 'failed') {
    return (
      <DetailPage header={<PageHeader title={title} subject={subject} />} details={details}>
        <Banner tone="warn">
          <p>{state.error}</p>
        </Banner>
      </DetailPage>
    );
  }

  return (
    <DetailPage
      header={<PageHeader title={title} subject={subject} />}
      details={details}
      text={
        minutes.since ? (
          <section aria-labelledby="board-since" className="space-y-2">
            <SectionHeading
              id="board-since"
              title={meeting.kind === 'called' ? 'Background' : 'Since last week'}
            />
            <Card padding="standard" className="space-y-2">
              <Prose markdown={minutes.since} />
            </Card>
          </section>
        ) : undefined
      }
    >
      {questions}

      {!isDebate && minutes.disagreements.length > 0 && (
        <section aria-labelledby="board-disagreements" className="space-y-3">
          <SectionHeading
            id="board-disagreements"
            title="Where the board disagrees"
            count={minutes.disagreements.length}
          />
          {minutes.disagreements.map((disagreement, index) => (
            <DisagreementCard
              key={disagreement.key ?? index}
              disagreement={disagreement}
              called={meeting.kind === 'called'}
              mark={markOf('vote', disagreement.key)}
              onVote={async (value, note) => {
                const result = await actions.vote(meeting.id, disagreement.key!, value, note);
                if (!result.error) keep('vote', disagreement.key!, result.saved);
                return result;
              }}
            />
          ))}
        </section>
      )}

      {minutes.dream && (
        <section aria-labelledby="board-dream" className="space-y-3">
          <SectionHeading id="board-dream" title="The dream on the table" />
          <Card padding="standard" className="space-y-3">
            <Prose markdown={minutes.dream.text} />
            {minutes.dream.thread && (
              <div className="space-y-0.5">
                <p className="text-small font-medium text-ink-muted">
                  The smallest thread this week
                </p>
                <Prose markdown={minutes.dream.thread} />
              </div>
            )}
            <Evidence
              receipts={minutes.dream.receipts}
              written={[minutes.dream.text, minutes.dream.thread ?? '']}
            />
          </Card>
        </section>
      )}

      {minutes.question && (
        <section aria-labelledby="board-question" className="space-y-3">
          <SectionHeading id="board-question" title="One question" />
          <QuestionCard
            question={minutes.question}
            mark={markOf('answer', 'question')}
            onAnswer={async (answer) => {
              const result = await actions.answer(meeting.id, answer);
              if (!result.error) keep('answer', 'question', result.saved);
              return result;
            }}
          />
        </section>
      )}

      {minutes.resolutions.length > 0 && (
        <section aria-labelledby="board-resolutions" className="space-y-3">
          <SectionHeading
            id="board-resolutions"
            title="Resolutions"
            count={counts.resolutions ? `${counts.done} of ${counts.resolutions} done` : undefined}
          />
          <Card padding="none">
            <ul className="divide-y divide-border">
              {minutes.resolutions.map((resolution, index) => (
                <ResolutionRow
                  key={resolution.key ?? index}
                  resolution={resolution}
                  mark={markOf('resolution', resolution.key)}
                  onTick={async (done) => {
                    const result = await actions.tick(meeting.id, resolution.key!, done);
                    if (!result.error) keep('resolution', resolution.key!, result.saved);
                    return result;
                  }}
                  onMakeTodo={async () => {
                    const result = await actions.makeTodo(meeting.id, resolution.key!);
                    if (!result.error) keep('resolution', resolution.key!, result.saved);
                    return result;
                  }}
                />
              ))}
            </ul>
            {minutes.resolutionsNote && (
              <Prose
                markdown={minutes.resolutionsNote}
                className={cn('card-pad-x border-t border-border py-3 text-ui text-ink-muted')}
              />
            )}
          </Card>
        </section>
      )}

      {minutes.predictions.length > 0 && (
        <section aria-labelledby="board-predictions" className="space-y-3">
          <SectionHeading id="board-predictions" title="Predictions for next week" />
          <Card padding="none">
            {minutes.predictionsNote && (
              <Prose
                markdown={minutes.predictionsNote}
                className={cn('card-pad-x border-b border-border py-3 text-ui text-ink-muted')}
              />
            )}
            <ul className="divide-y divide-border">
              {minutes.predictions.map((prediction, index) => (
                <li key={index} className="card-pad-x space-y-0.5 py-3">
                  <p className="text-small font-medium text-ink-muted">
                    <SeatLabel seat={prediction.seat} />
                  </p>
                  <Prose markdown={prediction.text} />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {(minutes.graded.length > 0 || (minutes.gradedNote && !isDebate)) && (
        <section aria-labelledby="board-graded" className="space-y-3">
          <SectionHeading id="board-graded" title="Last week’s predictions" />
          <Card padding="none">
            {minutes.gradedNote && (
              <Prose
                markdown={minutes.gradedNote}
                className={cn(
                  'card-pad-x py-3 text-ui text-ink-muted',
                  minutes.graded.length > 0 && 'border-b border-border',
                )}
              />
            )}
            {minutes.graded.length > 0 && (
              <ul className="divide-y divide-border">
                {minutes.graded.map((graded, index) => (
                  <li key={index} className="card-pad-x space-y-1 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-small font-medium text-ink-muted">
                        <SeatLabel seat={graded.seat} />
                      </p>
                      <GradeMark grade={graded.grade} />
                    </div>
                    <Prose markdown={graded.text} />
                    {graded.fact && (
                      <Prose markdown={graded.fact} className={cn('text-ui text-ink-muted')} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      <section aria-labelledby="board-scorecard" className="space-y-3">
        <SectionHeading id="board-scorecard" title="Scorecard" count="every meeting" />
        <Scorecard scores={scorecard} bare={isDebate} />
      </section>

      {minutes.memos.length > 0 && (
        <SectionFold
          title="The memos"
          count={minutes.memos.length}
          defaultOpen={open.memos ?? false}
        >
          <div className="space-y-3">
            <Card padding="none">
              {minutes.memosNote && (
                <div className="card-pad-x space-y-0.5 border-b border-border bg-sunken py-3">
                  <p className="text-small font-medium text-ink-muted">From the chair</p>
                  <Prose markdown={minutes.memosNote} className={cn('text-ui')} />
                </div>
              )}
              <ul className="divide-y divide-border">
                {minutes.memos.map((memo) => (
                  <li key={memo.seat} className="card-pad-x space-y-3 py-4">
                    <h3 className="text-ui font-semibold text-ink">
                      <SeatLabel seat={memo.seat} text={capital(SEAT_NAMES[memo.seat])} />
                    </h3>
                    <Prose markdown={memo.memo} />
                    {memo.resolution && (
                      <div className="space-y-0.5">
                        <p className="text-small font-medium text-ink-muted">Proposed</p>
                        <Prose markdown={memo.resolution} />
                      </div>
                    )}
                    {memo.prediction && (
                      <div className="space-y-0.5">
                        <p className="text-small font-medium text-ink-muted">Predicted</p>
                        <Prose markdown={memo.prediction} />
                      </div>
                    )}
                    {memo.rebuttal && (
                      <div className="space-y-0.5 border-l-2 border-border-strong pl-3">
                        <p className="text-small font-medium text-ink-muted">
                          {memo.rebuttal.to
                            ? `In reply to ${SEAT_NAMES[memo.rebuttal.to]}`
                            : capital(memo.rebuttal.stance ?? 'In reply')}
                        </p>
                        <Prose markdown={memo.rebuttal.text} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </SectionFold>
      )}

      {minutes.chairNote && (
        <SectionFold title="From the chair">
          <Card padding="standard">
            <Prose markdown={minutes.chairNote} className={cn('text-ui')} />
          </Card>
        </SectionFold>
      )}
      {drawer}
    </DetailPage>
  );
}

/**
 * One disagreement: the point, each seat's position with what it rests on,
 * and the vote. The seats offered are the ones that took a side here, then
 * Neither. A vote saves at once; the line of why under it saves on its own.
 */
function DisagreementCard({
  disagreement,
  called,
  mark,
  onVote,
}: {
  disagreement: BoardDisagreement;
  /** A called meeting: the decision is the page's title, and each seat's stance is its vote. */
  called: boolean;
  mark: BoardMark | undefined;
  onVote: (value: VoteValue, note: string | null) => Promise<BoardMarkResult>;
}) {
  const [pendingVote, setPendingVote] = useState<VoteValue | null>(null);
  const [note, setNote] = useState(mark?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [savingNote, startSavingNote] = useTransition();
  const [editingNote, setEditingNote] = useState(false);
  const seats = [...new Set(disagreement.positions.map((position) => position.seat))];
  const choices: VoteValue[] = [...seats, 'neither'];
  const chosen = (pendingVote ?? mark?.value ?? null) as VoteValue | null;
  const fieldId = `vote-why-${disagreement.key}`;

  const vote = async (value: VoteValue) => {
    setError(null);
    setPendingVote(value);
    const result = await onVote(value, note.trim() || null);
    setPendingVote(null);
    setError(result.error);
  };

  const saveNote = () =>
    startSavingNote(async () => {
      if (!mark) return;
      const result = await onVote(mark.value as VoteValue, note.trim() || null);
      setError(result.error);
      if (!result.error) setEditingNote(false);
    });

  return (
    <Card padding="standard" className="space-y-4" data-board-disagreement>
      {(!called || disagreement.note) && (
        <div className="space-y-1">
          {!called && (
            <h3 className="text-body font-semibold text-ink [overflow-wrap:anywhere]">
              {disagreement.point}
            </h3>
          )}
          {disagreement.note && <p className="text-ui text-ink-muted">{disagreement.note}</p>}
        </div>
      )}
      <ul className="space-y-4">
        {disagreement.positions.map((position, index) => (
          <li key={index} className="space-y-1">
            {called && position.stance ? (
              <p className="text-body font-semibold text-ink">
                <SeatLabel seat={position.seat} text={`${SEAT_LABELS[position.seat]} · ${position.stance}`} />
              </p>
            ) : (
              <p className="text-small font-medium text-ink-muted">
                <SeatLabel seat={position.seat} />
                {position.stance && <span className="font-normal">, {position.stance}</span>}
              </p>
            )}
            <Prose markdown={position.text} />
            <Evidence receipts={position.receipts} written={[position.text]} />
          </li>
        ))}
      </ul>

      {disagreement.key && (
        <div className="space-y-2 border-t border-border pt-4">
          <p id={`vote-${disagreement.key}`} className="text-ui font-medium text-ink">
            Who do you side with?
          </p>
          <div
            role="group"
            aria-labelledby={`vote-${disagreement.key}`}
            className="flex flex-wrap gap-2"
          >
            {choices.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant="secondary"
                pressed={chosen === value}
                pending={pendingVote === value}
                onClick={() => void vote(value)}
              >
                {value === 'neither' ? 'Neither' : <SeatLabel seat={value} />}
              </Button>
            ))}
          </div>
          {mark && editingNote && (
            <div className="space-y-2 pt-1">
              <Label htmlFor={fieldId} className="text-ui font-normal text-ink-muted">
                Why, if you want to say. The next meeting reads it.
              </Label>
              <Textarea
                id={fieldId}
                value={note}
                maxLength={2000}
                rows={2}
                autoFocus
                onChange={(event) => setNote(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                {note.trim() !== (mark.note ?? '') && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    pending={savingNote}
                    onClick={saveNote}
                  >
                    Save why
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNote(mark.note ?? '');
                    setEditingNote(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {mark && !editingNote && mark.note && (
            <div className="space-y-1 pt-1">
              <p className="border-l-2 border-border-strong pl-3 text-body text-ink [overflow-wrap:anywhere]">
                {mark.note}
              </p>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditingNote(true)}>
                Change why
              </Button>
            </div>
          )}
          {mark && !editingNote && !mark.note && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditingNote(true)}>
              Say why
            </Button>
          )}
          <FieldError>{error}</FieldError>
        </div>
      )}
    </Card>
  );
}

/** The meeting's one question and their answer, which the next meeting reads first. */
function QuestionCard({
  question,
  mark,
  onAnswer,
}: {
  question: string;
  mark: BoardMark | undefined;
  onAnswer: (answer: string) => Promise<BoardMarkResult>;
}) {
  const saved = mark?.value ?? '';
  const [draft, setDraft] = useState(saved);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const save = () =>
    startSaving(async () => {
      const result = await onAnswer(draft);
      setError(result.error);
      if (!result.error) {
        setDraft(result.saved?.value ?? '');
        setEditing(false);
      }
    });
  return (
    <Card padding="standard" className="space-y-3" data-board-question>
      <Label
        htmlFor={editing ? 'board-answer' : undefined}
        className="block text-body font-medium text-ink [overflow-wrap:anywhere]"
      >
        {question}
      </Label>
      {editing ? (
        <>
          <Textarea
            id="board-answer"
            value={draft}
            maxLength={4000}
            placeholder="The next meeting starts from your answer."
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            {draft.trim() && draft.trim() !== saved && (
              <Button type="button" size="sm" variant="secondary" pending={saving} onClick={save}>
                Save answer
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(saved);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : !saved ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
          Answer
        </Button>
      ) : (
        <div className="space-y-1">
          <p className="text-body text-ink [overflow-wrap:anywhere]">{saved}</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Change answer
          </Button>
        </div>
      )}
      <FieldError>{error}</FieldError>
    </Card>
  );
}

/** One resolution: the tick, what it is, by when and whose, and Make a todo or the todo made. */
function ResolutionRow({
  resolution,
  mark,
  onTick,
  onMakeTodo,
}: {
  resolution: BoardResolution;
  mark: BoardMark | undefined;
  onTick: (done: boolean) => Promise<BoardMarkResult>;
  onMakeTodo: () => Promise<BoardMarkResult>;
}) {
  const [done, setDone] = useState(mark?.value === 'done');
  const [error, setError] = useState<string | null>(null);
  const [making, startMaking] = useTransition();
  const boxId = `resolution-${resolution.key}`;
  const meta = [
    resolution.day ? `By ${dayLabel(resolution.day)}` : null,
    resolution.seats.length ? resolution.seats.map((seat) => SEAT_LABELS[seat]).join(', ') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const tick = async (next: boolean) => {
    setError(null);
    setDone(next);
    const result = await onTick(next);
    if (result.error) {
      setDone(!next);
      setError(result.error);
    }
  };

  return (
    <li className="card-pad-x space-y-2 py-3" data-board-resolution>
      <div className="flex items-start gap-3">
        {resolution.key && (
          // The label is the 44px press area around the 16px box; its
          // negative margins keep the box where it sat.
          <label
            htmlFor={boxId}
            className="-mx-3.5 -mt-2.5 -mb-3.5 flex size-11 shrink-0 cursor-pointer items-center justify-center"
          >
            <Checkbox
              id={boxId}
              checked={done}
              onChange={(event) => void tick(event.target.checked)}
              aria-label={done ? 'Done. Untick to mark it open' : 'Mark done'}
            />
          </label>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <Prose markdown={resolution.what} className={cn(done && 'text-ink-muted line-through')} />
          {meta && <p className="text-small text-ink-muted">{meta}</p>}
        </div>
      </div>
      {resolution.key && (
        <div className="pl-7">
          {mark?.todoId ? (
            <Link
              href={`/todo/all?status=all&focus=${mark.todoId}`}
              className={cn(linkVariants(), 'press-area text-ui')}
            >
              Open the todo
            </Link>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              pending={making}
              onClick={() =>
                startMaking(async () => {
                  const result = await onMakeTodo();
                  setError(result.error);
                })
              }
            >
              Make a todo
            </Button>
          )}
          <FieldError>{error}</FieldError>
        </div>
      )}
    </li>
  );
}

/** Each seat's hits and misses, counted from every meeting's graded predictions. */
function Scorecard({
  scores,
  bare = false,
}: {
  scores: readonly BoardScore[];
  /** A debate meeting: until something is graded, the line alone and no table of zeros. */
  bare?: boolean;
}) {
  const graded = scores.some((score) => score.hits || score.misses);
  if (bare && !graded) {
    return (
      <Card padding="standard">
        <p className="text-ui text-ink-muted">
          No prediction has been graded yet. The first are graded at the meeting after the week they
          cover.
        </p>
      </Card>
    );
  }
  return (
    <Card padding="none">
      <table className="w-full text-ui">
        <caption className="sr-only">Hits and misses for each seat, across every meeting</caption>
        <thead>
          <tr className="border-b border-border text-left text-small text-ink-muted">
            <th scope="col" className="card-pad-x py-2 font-medium">
              Seat
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Hits
            </th>
            <th scope="col" className="card-pad-x py-2 pl-0 text-right font-medium">
              Misses
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {scores.map((score) => (
            <tr key={score.seat}>
              <th scope="row" className="card-pad-x py-2 text-left font-normal text-ink">
                <SeatLabel seat={score.seat} />
              </th>
              <td className="tabular py-2 pr-4 text-right text-ink">{score.hits}</td>
              <td className="tabular card-pad-x py-2 pl-0 text-right text-ink">{score.misses}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!graded && (
        <p className="card-pad-x border-t border-border py-2 text-small text-ink-muted">
          No prediction has been graded yet. The first are graded at the meeting after the week they
          cover.
        </p>
      )}
    </Card>
  );
}
