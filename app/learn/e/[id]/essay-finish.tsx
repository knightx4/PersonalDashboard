'use client';

import { useCallback, useState } from 'react';
import Link from '@/components/ui/link';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { PaidHint } from '@/components/ui/paid-hint';
import type { EssayClaim, OfferedClaim } from '@/lib/learn/essays/finish';
import type { EssayStage } from '@/lib/learn/essays/note';
import { acceptEssayFinish, type AcceptFinishResult, type FinishResult } from './actions';

/**
 * Finish (plan #1873; spec, "Finishing and publishing"). One press saves the
 * essay to the vault as a seedling or later, logs it in the learning log and
 * reads off the claims it argues. What follows is offered, not done: a short
 * note in the Inbox for each claim the vault has no note for, and a place in
 * the Jobs evidence bank. Nothing is made until the person presses Add.
 */

type Offers = { claims: OfferedClaim[]; inEvidenceBank: boolean };

type Made = Extract<AcceptFinishResult, { ok: true }>;

/** Where the card has got to. Exported so the gallery can draw a state. */
export type FinishView =
  | { kind: 'idle' }
  | { kind: 'running' }
  | ({ kind: 'offers' } & Offers)
  | ({ kind: 'adding' } & Offers)
  | { kind: 'made'; made: Made }
  | { kind: 'failed'; error: string };

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What Add makes, said on the button: the notes, the bank item, or both. */
export function addLabel(notes: number, evidence: boolean): string {
  if (notes === 0) return evidence ? 'Add to the evidence bank' : 'Nothing ticked';
  const made = `Add ${plural(notes, 'note', 'notes')}`;
  return evidence ? `${made} and the bank item` : made;
}

/** The line under the heading once the essay is finished, naming its stage when this press set it. */
export function finishedLine(date: string, stage: EssayStage | null): string {
  const saved = stage ? `Saved to your vault as ${stage === 'evergreen' ? 'an' : 'a'} ${stage}` : 'Saved to your vault';
  return `Finished on ${date}. ${saved} and added to your learning log.`;
}

/** The offers: a tick for each claim without a note, and one for the evidence bank. */
function Offering({
  offers,
  busy,
  onAdd,
  onSkip,
}: {
  offers: Offers;
  busy: boolean;
  onAdd: (create: string[], evidence: boolean) => void;
  onSkip: () => void;
}) {
  const fresh = offers.claims.filter((claim) => !claim.existing);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(fresh.map((claim) => claim.name)));
  const [evidence, setEvidence] = useState(!offers.inEvidenceBank);
  const toggle = (name: string) =>
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const bank = evidence && !offers.inEvidenceBank;
  const count = picked.size + (bank ? 1 : 0);

  return (
    <div className="mt-3">
      <p className="text-ui text-ink">
        The essay argues {plural(offers.claims.length, 'claim', 'claims')}.{' '}
        {fresh.length > 0
          ? `${fresh.length} ${fresh.length === 1 ? 'has' : 'have'} no note in your vault yet.`
          : 'Your vault has a note for each.'}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {offers.claims.map((claim) => {
          const text = (
            <>
              <span className="block text-ui font-medium text-ink">{claim.name}</span>
              <span className="block text-small text-ink-muted">{claim.claim}</span>
            </>
          );
          return (
            <li key={claim.name}>
              {claim.existing ? (
                <div className="flex gap-2 py-1">
                  <span aria-hidden className="size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    {text}
                    <p className="mt-0.5 text-small text-ink-muted">
                      In your vault:{' '}
                      <Link href={claim.existing.href} className="text-accent underline underline-offset-2">
                        {claim.existing.title}
                      </Link>
                    </p>
                  </div>
                </div>
              ) : (
                <label className="flex min-h-11 cursor-pointer gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={picked.has(claim.name)}
                    disabled={busy}
                    onChange={() => toggle(claim.name)}
                    className="mt-0.5 size-4 shrink-0 accent-accent"
                  />
                  <span className="min-w-0 flex-1">{text}</span>
                </label>
              )}
            </li>
          );
        })}
      </ul>
      {fresh.length > 0 && (
        <p className="mt-2 text-small text-ink-muted">Ticked claims become short notes in your Inbox.</p>
      )}
      <div className="mt-3 flex gap-2 border-t border-border pt-3">
        {offers.inEvidenceBank ? (
          <>
            <span aria-hidden className="mt-1 size-4 shrink-0" />
            <p className="text-small text-ink-muted">This essay is already in your evidence bank.</p>
          </>
        ) : (
          <>
            <label className="flex min-h-11 flex-1 cursor-pointer gap-2">
              <input
                type="checkbox"
                checked={evidence}
                disabled={busy}
                onChange={() => setEvidence((on) => !on)}
                className="mt-0.5 size-4 shrink-0 accent-accent"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-ui font-medium text-ink">Add to your evidence bank</span>
                <span className="block text-small text-ink-muted">
                  One item in Jobs, something you can show you did, linking to this essay.
                </span>
              </span>
            </label>
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || count === 0}
          pending={busy}
          onClick={() => onAdd([...picked], bank)}
        >
          {busy ? 'Adding…' : addLabel(picked.size, bank)}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onSkip}>
          Not now
        </Button>
      </div>
    </div>
  );
}

/** What was made, with links to it. */
function MadeList({ made }: { made: Made }) {
  const bank =
    made.evidence === 'added'
      ? 'Added to your evidence bank.'
      : made.evidence === 'already'
        ? 'Already in your evidence bank.'
        : null;
  const nothing = made.created.length === 0 && !bank;
  return (
    <div className="mt-3" role="status">
      {made.created.length > 0 && (
        <>
          <p className="text-ui text-ink">
            {plural(made.created.length, 'note', 'notes')} in your Inbox:
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {made.created.map((note) => (
              <li key={note.href} className="text-ui">
                <Link href={note.href} className="text-accent underline underline-offset-2">
                  {note.name}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {bank && (
        <p className="mt-2 text-ui text-ink">
          {bank}{' '}
          <Link href="/jobs/material" className="text-accent underline underline-offset-2">
            Open the bank
          </Link>
        </p>
      )}
      {nothing && <p className="text-ui text-ink-muted">Nothing was added.</p>}
      {made.error && (
        <p role="alert" className="mt-2 text-small text-danger">
          {made.error}
        </p>
      )}
    </div>
  );
}

/**
 * The Finish card in the rail. `onFinish` saves and finishes through the
 * editor's own save queue (so the note's blob SHA stays current) and answers
 * with what the server found. `initial` is for the gallery, which draws a
 * state and never calls the server.
 */
export function EssayFinishCard({
  essayId,
  finishedAt,
  inEvidenceBank,
  canFinish,
  onFinish,
  onFinished,
  initial = { kind: 'idle' },
  className,
  stage = null,
}: {
  essayId: string;
  finishedAt: string | null;
  inEvidenceBank: boolean;
  /** False while the essay is empty or a vault save is running. */
  canFinish: boolean;
  onFinish: () => Promise<FinishResult>;
  /** Told when a press finishes the essay, so Publish can follow. */
  onFinished?: (at: string) => void;
  initial?: FinishView;
  className?: string;
  /** The note's stage, known once Finish has run in this visit (and in the gallery). */
  stage?: EssayStage | null;
}) {
  const [view, setView] = useState<FinishView>(initial);
  const [finished, setFinished] = useState(finishedAt);
  const [stageNow, setStageNow] = useState<EssayStage | null>(stage);

  const finish = useCallback(async () => {
    setView({ kind: 'running' });
    const result = await onFinish();
    if (!result.ok) {
      // A failed vault save is explained under the editor.
      setView(result.reason ? { kind: 'idle' } : { kind: 'failed', error: result.error });
      return;
    }
    setFinished(result.finishedAt);
    onFinished?.(result.finishedAt);
    setStageNow(result.stage);
    setView({ kind: 'offers', claims: result.claims, inEvidenceBank: result.inEvidenceBank });
  }, [onFinish, onFinished]);

  const add = useCallback(
    async (offers: Offers, create: string[], evidence: boolean) => {
      setView({ kind: 'adding', claims: offers.claims, inEvidenceBank: offers.inEvidenceBank });
      const claims = offers.claims;
      const all: EssayClaim[] = claims.map(({ name, claim }) => ({ name, claim }));
      let result: AcceptFinishResult;
      try {
        result = await acceptEssayFinish(essayId, all, create, evidence, browserTimeZone());
      } catch {
        result = { ok: false, error: 'The connection dropped. Try again in a moment.' };
      }
      if (!result.ok) {
        setView({ kind: 'failed', error: result.error });
        return;
      }
      setView({ kind: 'made', made: result });
    },
    [essayId],
  );

  const running = view.kind === 'running';
  const label = running ? 'Finishing…' : finished ? 'Finish again' : 'Finish';

  return (
    <Card padding="none" className={className}>
      <CardSection title="Finish">
        <p className="text-small text-ink-muted">
          {finished
            ? finishedLine(when(finished), stageNow)
            : 'Saves the essay to your vault as a seedling, logs it in your learning log with the claims it argues, and offers notes for the claims your vault lacks and an item in your Jobs evidence bank.'}
        </p>
        {finished && inEvidenceBank && view.kind === 'idle' && (
          <p className="mt-1 text-small text-ink-muted">It is in your evidence bank.</p>
        )}
        <div className="mt-2 flex items-center justify-end gap-1">
          <PaidHint action="app/learn/e/[id]/actions.ts#finishEssay" what="Cost of finishing" />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canFinish || running || view.kind === 'adding'}
            pending={running}
            onClick={() => void finish()}
          >
            {label}
          </Button>
        </div>
        {(view.kind === 'offers' || view.kind === 'adding') && (
          <Offering
            // The ticks start from the claims of this press.
            key={view.claims.map((claim) => claim.name).join('|')}
            offers={view}
            busy={view.kind === 'adding'}
            onAdd={(create, evidence) => void add(view, create, evidence)}
            onSkip={() => setView({ kind: 'idle' })}
          />
        )}
        {view.kind === 'made' && <MadeList made={view.made} />}
        {view.kind === 'failed' && (
          <p role="alert" className="mt-3 text-small text-danger">
            {view.error}
          </p>
        )}
      </CardSection>
    </Card>
  );
}
