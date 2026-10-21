'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { Card, CardSection } from '@/components/ui/card';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { ProseAtRest } from '@/components/ui/editable-prose';
import { EmptyState } from '@/components/ui/empty-state';
import { CheckRow, Textarea } from '@/components/ui/field';
import { Note } from '@/components/ui/note';
import { AddTrigger } from '@/components/ui/add-trigger';
import type { AnswerDraft } from '@/lib/jobs/evidence/draft-payload';
import { fromStoredDraft } from '@/lib/jobs/drafting/draft-application-payload';
import { answerLimit } from '@/lib/jobs/drafting/limits';
import type { StoredAsk } from '@/lib/jobs/drafting/store';
import {
  addQuestions,
  draftAnswerFromEvidence,
  draftApplication,
  dropAnswerDraft,
  promoteToCanonical,
  removeAnswer,
  saveAnswer,
  saveAnswerReplies,
  saveDraftedAnswer,
  type DraftApplicationResult,
} from '../actions';
import { saveApplicationMarks } from './actions';
import { Thread } from '@/components/thread/thread';
import type { DevComment } from '@/lib/comments/load';
import { threadRef } from '@/lib/thread/subjects';
import { CopyText } from './copy-text';
import { CoverLetter } from './cover-letter';
import { roleStage } from '@/lib/jobs/role-stage';
import { DashQuestions } from './dash-questions';
import { Considerations, DraftPanel, LimitCount, countOf } from './draft-panel';
import type { PanelProps } from './types';

export function Answers({
  answers,
  applicationId,
  roleId,
  coverLetter,
  companyName,
  readyToApply,
  allQuestionsAdded,
  hasCoverLetter,
  status,
  answerDrafts,
  dashAsks,
  draftRun,
  coverLetterDraft,
  coverLetterRun,
  answerThreads,
}: PanelProps) {
  // A closed application is read, not written: what was sent stays editable
  // as a record, but adding questions and drafting from the bank are folded
  // away (plan #1594).
  const closed = roleStage(status) === 'closed';
  const [paste, setPaste] = useState('');
  const [pasting, setPasting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Held here so saving an inserted letter can turn the Cover letter mark to
  // Yes above it (plan #2135.2).
  const [letterMark, setLetterMark] = useState(hasCoverLetter);

  // Dash's drafts and questions live here, above the cards, so one run can
  // fill every card and the questions panel at once (plan #2130.4). The run
  // is not a transition: the cards stay usable for the minute or two it takes.
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>(answerDrafts);
  const [asks, setAsks] = useState<StoredAsk[]>(dashAsks);
  const [running, setRunning] = useState(draftRun?.pending ?? false);
  const [runError, setRunError] = useState<string | null>(draftRun?.error ?? null);
  const [runNote, setRunNote] = useState<string | null>(null);

  const questionText = new Map(answers.map((answer) => [answer.id, answer.questionText]));

  /** Takes in what a run stored; returns the error to show, or null. */
  function apply(result: DraftApplicationResult): string | null {
    if (result.error || !result.drafts) return result.error ?? 'Nothing came back.';
    const stored = result.drafts;
    setDrafts(
      Object.fromEntries(
        Object.entries(stored.drafts)
          .filter(([id]) => questionText.has(id))
          .map(([id, draft]) => [id, fromStoredDraft(draft)]),
      ),
    );
    setAsks(stored.asks);
    const parts = [`Drafted ${countOf(result.drafted.length, 'answer', 'answers')}.`];
    if (result.flagged.length > 0) {
      parts.push(
        `${result.flagged.length === 1 ? 'One is' : `${result.flagged.length} are`} still over the limit.`,
      );
    }
    if (result.missing.length > 0) {
      parts.push(
        `No draft came back for ${countOf(result.missing.length, 'question', 'questions')}.`,
      );
    }
    setRunNote(parts.join(' '));
    return null;
  }

  async function run(input: { answerIds?: string[]; replies?: Record<string, string> }) {
    setRunning(true);
    setRunError(null);
    setRunNote(null);
    try {
      return apply(await draftApplication({ applicationId, ...input }));
    } catch {
      return 'Drafting stopped before it finished. Try again.';
    } finally {
      setRunning(false);
    }
  }

  async function draftAll() {
    setRunError(await run({}));
  }

  // Redraft redoes the drafts on screen and the answers Dash asked about, now
  // with the replies. With none of either, it is a full run.
  async function redraft(replies: Record<string, string>) {
    const ids = new Set(Object.keys(drafts));
    for (const ask of asks) if (ask.answer_id) ids.add(ask.answer_id);
    const answerIds = [...ids].filter((id) => questionText.has(id));
    return run({ answerIds: answerIds.length > 0 ? answerIds : undefined, replies });
  }

  return (
    <div className="space-y-4">
      <ApplicationMarks
        applicationId={applicationId}
        roleId={roleId}
        closed={closed}
        initialReady={readyToApply}
        initialAllQuestions={allQuestionsAdded}
        letter={letterMark}
        onLetter={setLetterMark}
      />
      {/* The panel is the answers. Adding questions is something you do to it
          now and then, and it used to be a four-row textarea sitting above
          them on every visit -- the first thing on a page you came to read.
          It opens when you are actually adding something (law 14).

          Not offered at all when there is nothing here yet: the empty state
          below is the invitation, and two invitations to the same thing on one
          screen is one too many. */}
      {pasting ? (
        <CardSection title="Add the application questions" hint="One per line, or numbered.">
          <Textarea
            rows={4}
            autoFocus
            value={paste}
            aria-label="Application questions"
            onChange={(event) => setPaste(event.target.value)}
            placeholder={'1. Why do you want to work here?\n2. Tell us about a time you...'}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || !paste.trim()}
              onClick={() =>
                startTransition(async () => {
                  const result = await addQuestions(applicationId, paste);
                  setMessage(result.error ?? `Added ${result.added}.`);
                  if (!result.error) {
                    setPaste('');
                    setPasting(false);
                  }
                })
              }
            >
              Add questions
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setPaste('');
                setPasting(false);
              }}
            >
              Cancel
            </Button>
            {message && <span className="text-small text-ink-muted">{message}</span>}
          </div>
        </CardSection>
      ) : (
        answers.length > 0 &&
        !closed && (
          <div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <DashAction
                type="button"
                size="sm"
                variant="secondary"
                pending={running}
                disabled={running}
                paid="app/jobs/(app)/roles/actions.ts#draftApplication"
                what="Cost of drafting every answer"
                onClick={() => void draftAll()}
              >
                {running ? 'Drafting…' : 'Draft all answers'}
              </DashAction>
              <AddTrigger label="Add more questions" onClick={() => setPasting(true)} />
            </div>
            {running ? (
              <Note role="status" className="mt-2 px-3 py-2 text-small text-ink-muted">
                Dash is drafting each answer, which takes a minute or two. You can keep working
                below.
              </Note>
            ) : runError ? (
              <p role="alert" className="mt-1.5 text-small text-danger">
                Drafting failed: {runError}
              </p>
            ) : (
              (runNote || message) && (
                <p role="status" className="mt-1.5 text-small text-ink-muted">
                  {[runNote, message].filter(Boolean).join(' ')}
                </p>
              )
            )}
          </div>
        )
      )}

      {!closed && asks.length > 0 && (
        <DashQuestions
          asks={asks}
          aboutLabel={(answerId) => {
            if (answerId === null) return 'About the whole application';
            const question = questionText.get(answerId);
            return question ? `For “${question}”` : 'For a question no longer on this application';
          }}
          onSaveReply={async (askId, reply) => {
            const result = await saveAnswerReplies({ applicationId, replies: { [askId]: reply } });
            if (!result.error) {
              setAsks((before) =>
                before.map((ask) => (ask.id === askId ? { ...ask, reply: reply || null } : ask)),
              );
            }
            return result.error;
          }}
          onRedraft={redraft}
          redraftPaid="app/jobs/(app)/roles/actions.ts#draftApplication"
          busy={running}
        />
      )}

      {answers.length === 0 ? (
        // The paste box above is the action that fills this; the link goes to
        // the bookmarklet, which is the other way in. The paste box is no
        // longer standing open above this, so the empty state has to offer it:
        // law 15 puts the teaching here, which is where somebody seeing this
        // panel for the first time is standing.
        !pasting &&
        (closed ? (
          <p className="text-ui text-ink-muted">
            No application questions were captured before this closed.
          </p>
        ) : (
          <EmptyState
            icon={MessageSquareText}
            title="No questions captured yet"
            description="Paste the questions from the application, or grab them from the page itself with the bookmarklet."
            action={{ label: 'Get the bookmarklet', href: '/jobs/settings' }}
          >
            <AddTrigger label="Paste the questions" onClick={() => setPasting(true)} />
          </EmptyState>
        ))
      ) : (
        <div className="space-y-3">
          {answers.map((answer) => (
            <AnswerCard
              key={answer.id}
              answer={answer}
              closed={closed}
              thread={answerThreads?.[threadRef('answer', answer.id)] ?? []}
              draft={drafts[answer.id] ?? null}
              onDraftChange={(draft) =>
                setDrafts((before) => {
                  const next = { ...before };
                  if (draft) next[answer.id] = draft;
                  else delete next[answer.id];
                  return next;
                })
              }
              onAsks={setAsks}
            />
          ))}
        </div>
      )}

      {/* Keyed on the text so a letter Dash writes from the Comments tab
          replaces what this box holds rather than sitting behind it. Marked
          No, the application takes no letter, so there is none to write
          (note 67df30d0); pressing No again brings it back. */}
      {letterMark !== false && (
        <CoverLetter
          key={coverLetter}
          applicationId={applicationId}
          roleId={roleId}
          companyName={companyName}
          initial={coverLetter}
          closed={closed}
          initialDraft={coverLetterDraft}
          initialRun={coverLetterRun}
          onMarkedYes={() => setLetterMark(true)}
          thread={answerThreads?.[threadRef('application', applicationId)] ?? []}
        />
      )}
    </div>
  );
}

/**
 * Two marks you keep on the application: ready to apply, and whether it has a
 * cover letter (plan #2102.2). The cover letter answer is yours, separate from
 * the text below it. Pressing the pressed answer again clears it. Each press
 * saves at once; a closed application shows them without the controls.
 */
function ApplicationMarks({
  applicationId,
  roleId,
  closed,
  initialReady,
  initialAllQuestions,
  letter,
  onLetter: setLetter,
}: {
  applicationId: string;
  roleId: string;
  closed: boolean;
  initialReady: boolean;
  initialAllQuestions: boolean;
  /** The Cover letter mark, held by the tab so saving an inserted letter can set it. */
  letter: boolean | null;
  onLetter: (letter: boolean | null) => void;
}) {
  const [ready, setReady] = useState(initialReady);
  const [allQuestions, setAllQuestions] = useState(initialAllQuestions);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(
    marks: { readyToApply?: boolean; allQuestionsAdded?: boolean; hasCoverLetter?: boolean | null },
    revert: () => void,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await saveApplicationMarks({ applicationId, roleId, ...marks });
      if (result.error) {
        revert();
        setError(result.error);
      }
    });
  }

  function pressLetter(answer: boolean) {
    const before = letter;
    const next = before === answer ? null : answer;
    setLetter(next);
    save({ hasCoverLetter: next }, () => setLetter(before));
  }

  if (closed) {
    return (
      <Card padding="dense">
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-ui text-ink-muted">
          <span className="whitespace-nowrap">
            {ready ? 'Marked ready to apply' : 'Not marked ready to apply'}
          </span>
          <span className="whitespace-nowrap">
            {allQuestions ? 'All questions added' : 'Not all questions added'}
          </span>
          <span className="whitespace-nowrap">
            {letter === null
              ? 'Cover letter not answered'
              : letter
                ? 'Has a cover letter'
                : 'No cover letter'}
          </span>
        </p>
      </Card>
    );
  }

  return (
    <Card padding="dense">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <CheckRow
          title="Ready to apply"
          className="items-center"
          checked={ready}
          disabled={pending}
          onChange={(event) => {
            const before = ready;
            const next = event.target.checked;
            setReady(next);
            save({ readyToApply: next }, () => setReady(before));
          }}
        />
        <CheckRow
          title="All questions added"
          className="items-center"
          checked={allQuestions}
          disabled={pending}
          onChange={(event) => {
            const before = allQuestions;
            const next = event.target.checked;
            setAllQuestions(next);
            save({ allQuestionsAdded: next }, () => setAllQuestions(before));
          }}
        />
        <div role="group" aria-label="Has a cover letter" className="flex items-center gap-2">
          <span className="text-ui text-ink">Cover letter</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            pressed={letter === true}
            disabled={pending}
            onClick={() => pressLetter(true)}
          >
            Yes
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            pressed={letter === false}
            disabled={pending}
            onClick={() => pressLetter(false)}
          >
            No
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-small text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}

/** One question and its answer; exported for the preview gallery. */
export function AnswerCard({
  answer,
  closed,
  thread = [],
  initialDraft = null,
  draft: heldDraft,
  onDraftChange,
  onAsks,
}: {
  answer: PanelProps['answers'][number];
  /** The application has closed: no drafting from the bank. */
  closed: boolean;
  /** The comments under this answer (note be3c6616). */
  thread?: DevComment[];
  /** For the preview gallery: the card opens with this draft beside it. */
  initialDraft?: AnswerDraft | null;
  /** With onDraftChange, the draft is held above the card, where Draft all answers fills it. */
  draft?: AnswerDraft | null;
  onDraftChange?: (draft: AnswerDraft | null) => void;
  /** Dash's questions after this card's own draft, which may have asked something new. */
  onAsks?: (asks: StoredAsk[]) => void;
}) {
  const [text, setText] = useState(answer.answer || answer.canonicalAnswer || '');
  const [status, setStatus] = useState(answer.status);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  // The draft lives beside the textarea, and never in it. It reaches the
  // answer only through Insert, and the record only through Save -- the
  // compose.ts rule: the model may prepare text, but nothing goes out over
  // your name that you did not put there.
  const [ownDraft, setOwnDraft] = useState<AnswerDraft | null>(initialDraft);
  const held = onDraftChange !== undefined;
  const draft = held ? (heldDraft ?? null) : ownDraft;
  const setDraft = held ? onDraftChange : setOwnDraft;
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const usingCanonical = !answer.answer && Boolean(answer.canonicalAnswer);
  // Set on the row, or written into the question: "(140 characters)".
  const limit = answerLimit(answer.wordLimit, answer.questionText);

  // Inserted or discarded, the draft also leaves the stored drafts, so a
  // reload does not offer it again. Best effort: the card has moved on.
  function forget() {
    if (held) void dropAnswerDraft({ answerId: answer.id }).catch(() => undefined);
  }

  return (
    <Card padding="dense">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-ui font-medium text-ink">{answer.questionText}</p>
          <p className="mt-0.5 text-small text-ink-muted">
            {answer.questionKind}
            {answer.timesSeen > 1 && ` · asked ${answer.timesSeen} times`}
            {limit && (
              <>
                {' · '}
                <LimitCount text={text} limit={limit} />
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Positive rather than the offer hue: an approved answer is a thing
              done, not a pipeline stage. */}
          {status === 'approved' && (
            <CheckCircle2
              className="size-4 shrink-0 text-positive"
              strokeWidth={1.75}
              aria-label="Approved"
            />
          )}
          {!editing && text.trim() && <CopyText text={text} what="answer" />}
          {/* Up here, opposite the question it removes, rather than at the end
              of the action row, where on a phone it wrapped onto a line alone. */}
          {!editing && (
            <ConfirmStep
              prompt="Take this question off the application? It stays in your bank with its default answer."
              confirmLabel="Remove"
              pendingLabel="Removing…"
              onConfirm={async () => {
                const result = await removeAnswer(answer.id);
                if (result.error) throw new Error(result.error);
              }}
            >
              Remove
            </ConfirmStep>
          )}
        </div>
      </div>

      {usingCanonical && (
        <Note tone="accent" className="mt-2 text-small">
          Filled from your default answer for this question. Edit it if this one needs tailoring.
        </Note>
      )}

      {/*
        How to approach this question, from the draft the answer came from,
        still shown after the reload. It replaced the list of claims the bank
        did not carry: a gap in the bank is one of these, said as what to add.
        While a new draft is open its own considerations show in the panel.
      */}
      {!draft && answer.considerations.length > 0 && (
        <Considerations items={answer.considerations} className="mt-2" />
      )}

      {/* The answer, read. It was a five-row textarea holding its own value,
          open on arrival, one per question -- so a page whose job is to show
          what you have already written showed a column of editors instead, and
          the answers themselves were never once set as prose. Law 14. Editing
          is one click and happens in the same place at the same size. */}
      {editing ? (
        <Textarea
          rows={5}
          value={text}
          autoFocus
          aria-label="Your answer"
          onChange={(event) => setText(event.target.value)}
          className="mt-2"
        />
      ) : (
        <ProseAtRest
          text={text}
          onEdit={() => setEditing(true)}
          title="Edit this answer"
          empty="Not answered yet."
          className="mt-2"
        />
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Save and Approve are what you do to an answer you are writing, so
            they are where the writing is. Reading it, the only offers are the
            two that make sense on a finished answer: edit it, or draft one. */}
        {editing && (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await saveAnswer(answer.id, text, 'draft');
                  setSaved(result.error ?? 'Saved.');
                  if (!result.error) {
                    setStatus('draft');
                    setEditing(false);
                  }
                })
              }
            >
              Save draft
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || !text.trim()}
              onClick={() =>
                startTransition(async () => {
                  const result = await saveAnswer(answer.id, text, 'approved');
                  setSaved(result.error ?? 'Approved.');
                  if (!result.error) {
                    setStatus('approved');
                    setEditing(false);
                  }
                })
              }
            >
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setText(answer.answer || answer.canonicalAnswer || '');
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </>
        )}
        {!editing && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {text.trim() ? 'Edit' : 'Write an answer'}
          </Button>
        )}
        {!closed && (
          <DashAction
            type="button"
            size="sm"
            variant="ghost"
            pending={drafting}
            disabled={drafting}
            paid="app/jobs/(app)/roles/actions.ts#draftAnswerFromEvidence"
            what="Cost of drafting"
            onClick={() => {
              setDrafting(true);
              setDraftError(null);
              startTransition(async () => {
                const result = await draftAnswerFromEvidence({ answerId: answer.id });
                setDrafting(false);
                if (result.error || !result.draft) {
                  setDraftError(result.error ?? 'Nothing came back.');
                  return;
                }
                setDraft(result.draft);
                if (result.asks) onAsks?.(result.asks);
              });
            }}
          >
            {drafting ? 'Drafting…' : draft ? 'Draft again' : 'Draft an answer'}
          </DashAction>
        )}
        {/* Last, and a link with no padding, so on a phone where it wraps it
            starts on the card's text edge (law 18). */}
        {!editing && status === 'approved' && !answer.canonicalAnswer && (
          <Button
            type="button"
            size="sm"
            variant="link"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await promoteToCanonical(answer.questionId, text);
                setSaved(result.error ?? 'This is now your default answer for this question.');
              })
            }
          >
            Make this my default answer
          </Button>
        )}
        {saved && <span className="text-small text-ink-muted">{saved}</span>}
        {draftError && <span className="text-small text-danger">{draftError}</span>}
      </div>

      {draft && (
        <DraftPanel
          className="mt-3"
          draft={draft}
          limit={limit}
          pending={pending}
          onInsert={() => {
            setText(draft.text);
            startTransition(async () => {
              const result = await saveDraftedAnswer({
                answerId: answer.id,
                answer: draft.text,
                evidenceItemIds: draft.evidenceItemIds,
                unsupportedClaims: draft.unsupportedClaims,
                considerations: draft.considerations ?? [],
              });
              setSaved(result.error ?? 'Inserted and saved as a draft.');
              if (!result.error) {
                setStatus('draft');
                setDraft(null);
                forget();
              }
            });
          }}
          onDiscard={() => {
            setDraft(null);
            forget();
          }}
        />
      )}
      {/* Comments on this answer: a note to yourself, or @dash to ask
          for a change (note be3c6616). */}
      <div className="mt-3">
        <Thread
          subject={threadRef('answer', answer.id)}
          turns={thread}
          placeholder="A note on this answer, or @dash make it shorter."
        />
      </div>
    </Card>
  );
}
