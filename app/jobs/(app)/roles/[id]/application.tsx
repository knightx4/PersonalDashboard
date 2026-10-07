'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { ProseAtRest } from '@/components/ui/editable-prose';
import { EmptyState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/field';
import { AddTrigger } from '@/components/ui/add-trigger';
import type { AnswerDraft } from '@/lib/jobs/evidence/draft-payload';
import {
  addQuestions,
  draftAnswerFromEvidence,
  promoteToCanonical,
  saveAnswer,
  saveDraftedAnswer,
} from '../actions';
import { saveCoverLetter } from './actions';
import { PaidHint } from '@/components/ui/paid-hint';
import { LinkedText } from '@/components/ui/linked-text';
import type { PanelProps } from './types';

export function Answers({ answers, applicationId, bankSize, roleId, coverLetter }: PanelProps) {
  const [paste, setPaste] = useState('');
  const [pasting, setPasting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
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
        answers.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <AddTrigger label="Add more questions" onClick={() => setPasting(true)} />
            {message && <span className="text-small text-ink-muted">{message}</span>}
          </div>
        )
      )}

      {answers.length === 0 ? (
        // The paste box above is the action that fills this; the link goes to
        // the bookmarklet, which is the other way in. The paste box is no
        // longer standing open above this, so the empty state has to offer it:
        // law 15 puts the teaching here, which is where somebody seeing this
        // panel for the first time is standing.
        !pasting && (
          <EmptyState
            icon={MessageSquareText}
            title="No questions captured yet"
            description="Paste the questions from the application, or grab them from the page itself with the bookmarklet."
            action={{ label: 'Get the bookmarklet', href: '/jobs/settings' }}
          >
            <AddTrigger label="Paste the questions" onClick={() => setPasting(true)} />
          </EmptyState>
        )
      ) : (
        <div className="space-y-3">
          {answers.map((answer) => (
            <AnswerCard key={answer.id} answer={answer} bankSize={bankSize} />
          ))}
        </div>
      )}

      {/* Keyed on the text so a letter Dash writes from the Comments tab
          replaces what this box holds rather than sitting behind it. */}
      <CoverLetter
        key={coverLetter}
        applicationId={applicationId}
        roleId={roleId}
        initial={coverLetter}
      />
    </div>
  );
}

/**
 * The cover letter sent with this application (note b4cecf70), under the
 * answers because it is part of the same submission. Read as prose and edited
 * in place, as an answer is.
 */
function CoverLetter({
  applicationId,
  roleId,
  initial,
}: {
  applicationId: string;
  roleId: string;
  initial: string;
}) {
  const [text, setText] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <CardSection title="Cover letter">
      {editing ? (
        <Textarea
          rows={12}
          value={text}
          autoFocus
          aria-label="Cover letter"
          onChange={(event) => setText(event.target.value)}
        />
      ) : (
        <ProseAtRest
          text={text}
          onEdit={() => setEditing(true)}
          title="Edit the cover letter"
          empty="No cover letter yet."
        />
      )}
      {(editing || saved) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {editing && (
            <>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await saveCoverLetter({ applicationId, roleId, body: text });
                    setSaved(result.error ?? 'Saved.');
                    if (!result.error) setEditing(false);
                  })
                }
              >
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setText(initial);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </>
          )}
          {saved && <span className="text-small text-ink-muted">{saved}</span>}
        </div>
      )}
    </CardSection>
  );
}

function AnswerCard({
  answer,
  bankSize,
}: {
  answer: PanelProps['answers'][number];
  bankSize: number;
}) {
  const [text, setText] = useState(answer.answer || answer.canonicalAnswer || '');
  const [status, setStatus] = useState(answer.status);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  // The draft lives here, beside the textarea, and never in it. It reaches the
  // answer only through Insert, and the record only through Save -- the
  // compose.ts rule: the model may prepare text, but nothing goes out over
  // your name that you did not put there.
  const [draft, setDraft] = useState<AnswerDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const usingCanonical = !answer.answer && Boolean(answer.canonicalAnswer);

  return (
    <Card padding="dense">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-ui font-medium text-ink">{answer.questionText}</p>
          <p className="mt-0.5 text-small text-ink-muted">
            {answer.questionKind}
            {answer.timesSeen > 1 && ` · asked ${answer.timesSeen} times`}
          </p>
        </div>
        {/* Positive rather than the offer hue: an approved answer is a thing
            done, not a pipeline stage. */}
        {status === 'approved' && (
          <CheckCircle2
            className="size-4 shrink-0 text-positive"
            strokeWidth={1.75}
            aria-label="Approved"
          />
        )}
      </div>

      {usingCanonical && (
        <p className="mt-2 rounded bg-accent-tint px-2 py-1 text-small text-accent">
          Filled from your default answer for this question. Edit it if this one needs tailoring.
        </p>
      )}

      {/*
        The claims a saved draft could not ground, still shown after the reload.
        This is the one thing worth re-reading before you submit, so it does not
        live only in the session that generated it.
      */}
      {!draft && answer.unsupportedClaims.length > 0 && (
        <div className="mt-2 rounded bg-caution-tint px-2 py-1.5">
          <p className="text-small font-medium text-ink">
            This answer states things your bank does not carry:
          </p>
          <ul className="mt-0.5 list-disc pl-4 text-small text-ink">
            {answer.unsupportedClaims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        </div>
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
        {!editing && status === 'approved' && !answer.canonicalAnswer && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          pending={drafting}
          disabled={bankSize === 0}
          title={
            bankSize === 0
              ? 'Your evidence bank is empty, so there is nothing to draft from.'
              : undefined
          }
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
            });
          }}
        >
          {drafting ? 'Drafting…' : 'Draft from my evidence'}
        </Button>
        {bankSize > 0 && (
          <PaidHint
            action="app/jobs/(app)/roles/actions.ts#draftAnswerFromEvidence"
            what="Cost of drafting"
          />
        )}
        {saved && <span className="text-small text-ink-muted">{saved}</span>}
        {draftError && <span className="text-small text-danger">{draftError}</span>}
      </div>

      {draft && (
        // A well, not a frame. This is the one thing on the page that is not
        // yours yet -- a machine's suggestion waiting to be inserted or thrown
        // away -- and a recessed ground says that without adding a second
        // border inside the answer card. Law 11: a shared ground groups.
        <div className="mt-3 rounded-card bg-canvas p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-small font-medium text-ink">A draft, from your own stories</h4>
            <span className="text-small text-ink-muted">
              Nothing is saved until you insert it and save.
            </span>
          </div>

          <p className="mt-2 whitespace-pre-wrap text-ui leading-relaxed text-ink">
            <LinkedText text={draft.text} />
          </p>

          <p className="mt-2 text-small text-ink-muted">
            Draws on{' '}
            {draft.evidenceItemIds.length === 1
              ? 'one item'
              : `${draft.evidenceItemIds.length} items`}{' '}
            from your bank.
          </p>

          {draft.unsupportedClaims.length > 0 && (
            <div className="mt-2 rounded bg-caution-tint px-2 py-1.5">
              <p className="text-small font-medium text-ink">Not grounded in anything you wrote:</p>
              <ul className="mt-0.5 list-disc pl-4 text-small text-ink">
                {draft.unsupportedClaims.map((claim) => (
                  <li key={claim}>{claim}</li>
                ))}
              </ul>
              <p className="mt-1 text-small text-ink-muted">
                Check each of these before it goes out, or cut it.
              </p>
            </div>
          )}

          {draft.bannedFound.length > 0 && (
            <p className="mt-2 text-small text-caution">
              Uses {draft.bannedFound.map((phrase) => `“${phrase}”`).join(', ')} — on your banned
              list.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setText(draft.text);
                startTransition(async () => {
                  const result = await saveDraftedAnswer({
                    answerId: answer.id,
                    answer: draft.text,
                    evidenceItemIds: draft.evidenceItemIds,
                    unsupportedClaims: draft.unsupportedClaims,
                  });
                  setSaved(result.error ?? 'Inserted and saved as a draft.');
                  if (!result.error) {
                    setStatus('draft');
                    setDraft(null);
                  }
                });
              }}
            >
              Insert
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
