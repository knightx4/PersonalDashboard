'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { CardSection } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { ProseAtRest } from '@/components/ui/editable-prose';
import { Textarea } from '@/components/ui/field';
import { Note } from '@/components/ui/note';
import { Thread } from '@/components/thread/thread';
import type { DevComment } from '@/lib/comments/load';
import { threadRef } from '@/lib/thread/subjects';
import { CopyText } from './copy-text';
import type { CoverLetterDraftView } from '@/lib/jobs/drafting/draft-cover-letter-payload';
import type { StoredAsk } from '@/lib/jobs/drafting/store';
import {
  draftCoverLetter,
  dropCoverLetterDraft,
  saveCoverLetter,
  saveCoverLetterReplies,
} from './actions';
import { DashQuestions } from './dash-questions';
import { DraftPanel } from './draft-panel';
import { LetterPdf } from './letter-pdf';

const DRAFT_LETTER = 'app/jobs/(app)/roles/[id]/actions.ts#draftCoverLetter';

/**
 * The cover letter sent with this application (note b4cecf70), under the
 * answers because it is part of the same submission. Read as prose and edited
 * in place, as an answer is.
 *
 * Dash drafts one from everything on file (plan #2135.2). The draft sits
 * beside the letter in the shared draft panel and never in it: Insert puts it
 * in the editor, and the Save after that writes the letter and marks the
 * application as having a cover letter in one write. Dash's questions about
 * the letter show under it, with Redraft, only while there is a draft.
 */
export function CoverLetter({
  applicationId,
  roleId,
  companyName,
  initial,
  closed,
  initialDraft,
  initialRun,
  onMarkedYes,
  thread = [],
}: {
  applicationId: string;
  roleId: string;
  /** Heads the downloaded PDF, under the date. */
  companyName: string;
  initial: string;
  /** The application has closed: the letter stays editable as a record, but Dash does not draft. */
  closed: boolean;
  /** Dash's stored draft, from application_drafts. */
  initialDraft: CoverLetterDraftView | null;
  /** For the preview gallery: a draft drawn mid-run, or failed. */
  initialRun?: { pending: boolean; error: string | null };
  /** Saving an inserted draft set the Cover letter mark to Yes. */
  onMarkedYes?: () => void;
  /** The comments under the letter (note be3c6616). */
  thread?: DevComment[];
}) {
  const [text, setText] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState<CoverLetterDraftView | null>(initialDraft);
  // The draft's text is in the editor, waiting for Save. The panel steps
  // aside meanwhile, and Cancel brings it back.
  const [inserted, setInserted] = useState(false);
  // Not a transition: the letter stays readable for the minute a draft takes.
  const [running, setRunning] = useState(initialRun?.pending ?? false);
  const [runError, setRunError] = useState<string | null>(initialRun?.error ?? null);

  /** Drafts the letter, with any replies; returns the error to show, or null. */
  async function run(replies?: Record<string, string>): Promise<string | null> {
    setRunning(true);
    setRunError(null);
    try {
      const result = await draftCoverLetter({ applicationId, replies });
      if (result.error || !result.draft) return result.error ?? 'Nothing came back.';
      setDraft(result.draft);
      setInserted(false);
      return null;
    } catch {
      return 'Drafting stopped before it finished. Try again.';
    } finally {
      setRunning(false);
    }
  }

  function setAsks(update: (asks: StoredAsk[]) => StoredAsk[]) {
    setDraft((before) => (before ? { ...before, asks: update(before.asks) } : before));
  }

  const showDraft = !closed && draft !== null && !inserted;

  return (
    <>
      <CardSection
        title="Cover letter"
        action={!editing && text.trim() ? <CopyText text={text} what="cover letter" /> : undefined}
      >
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

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await saveCoverLetter({
                      applicationId,
                      roleId,
                      body: text,
                      fromDraft: inserted,
                    });
                    if (result.error) {
                      setSaved(result.error);
                      return;
                    }
                    setEditing(false);
                    if (inserted && text.trim()) {
                      setSaved('Saved, and marked as having a cover letter.');
                      setDraft(null);
                      setInserted(false);
                      onMarkedYes?.();
                    } else {
                      setSaved('Saved.');
                    }
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
                  setInserted(false);
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              {text.trim() && <LetterPdf text={text} company={companyName} />}
              {!closed && (
                <DashAction
                  type="button"
                  size="sm"
                  variant="secondary"
                  pending={running}
                  disabled={running}
                  paid={DRAFT_LETTER}
                  what="Cost of drafting the letter"
                  onClick={() => void run().then(setRunError)}
                >
                  {running ? 'Drafting…' : draft ? 'Draft again' : 'Draft a cover letter'}
                </DashAction>
              )}
            </>
          )}
          {saved && !running && <span className="text-small text-ink-muted">{saved}</span>}
        </div>

        {running ? (
          <Note role="status" className="mt-2 px-3 py-2 text-small text-ink-muted">
            Dash is writing the letter from everything on file, which takes a minute. You can keep
            working.
          </Note>
        ) : (
          runError && (
            <p role="alert" className="mt-1.5 text-small text-danger">
              Drafting failed: {runError}
            </p>
          )
        )}

        {showDraft && (
          <DraftPanel
            className="mt-3"
            draft={{
              text: draft.letter,
              evidenceItemIds: draft.evidenceItemIds,
              unsupportedClaims: draft.unsupportedClaims,
              bannedFound: draft.bannedFound,
            }}
            pending={pending}
            onInsert={() => {
              setText(draft.letter);
              setEditing(true);
              setInserted(true);
              setSaved(null);
            }}
            onDiscard={() => {
              setDraft(null);
              // Best effort: the panel has gone either way.
              void dropCoverLetterDraft({ applicationId }).catch(() => undefined);
            }}
          />
        )}

        {/* Comments on the letter: a note to yourself, or @dash to ask for a
            change (note be3c6616). */}
        <div className="mt-3">
          <Thread
            subject={threadRef('application', applicationId)}
            turns={thread}
            placeholder="A note on the letter, or @dash make the opening warmer."
          />
        </div>
      </CardSection>

      {showDraft && draft.asks.length > 0 && (
        <DashQuestions
          // A redraft can ask new questions; the reply boxes start again from them.
          key={draft.asks.map((ask) => ask.id).join(',')}
          asks={draft.asks}
          aboutLabel={() => 'About the cover letter'}
          hint="A line each is enough. Redraft writes the letter again with your replies."
          onSaveReply={async (askId, reply) => {
            const result = await saveCoverLetterReplies({
              applicationId,
              replies: { [askId]: reply },
            });
            if (!result.error) {
              setAsks((asks) =>
                asks.map((ask) => (ask.id === askId ? { ...ask, reply: reply || null } : ask)),
              );
            }
            return result.error;
          }}
          onRedraft={(replies) => run(replies)}
          redraftPaid={DRAFT_LETTER}
          busy={running}
        />
      )}
    </>
  );
}
