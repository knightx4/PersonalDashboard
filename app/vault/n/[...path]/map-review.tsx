'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { MapPosition } from '@/components/vault/map-position';
import { cn } from '@/lib/cn';
import { allKeys, edgeKey, keepTickedMap } from '@/lib/vault/map/keep';
import { EDGE_VERB } from '@/lib/vault/map/labels';
import type { NoteMap, NoteMapProposal } from '@/lib/vault/map/proposal';
import { acceptMap, proposeMap, type AcceptMapState, type ProposeMapState } from './actions';
import { PaidHint } from '@/components/ui/paid-hint';

/**
 * What the map would make of this note, and the tick that decides what of it
 * is kept.
 *
 * The proposal is held in this component's state and nowhere else. Leaving the
 * page throws it away, which is the point: nothing reaches the map until
 * somebody has read it and pressed accept.
 *
 * Everything starts ticked. The reading is usually mostly right, so the work
 * the screen asks for is finding what is wrong, and the counts on the button
 * are recomputed from the same rule the server applies, so unticking a theme
 * shows which positions it takes with it before anything is written.
 */

function ReadButton({ again }: { again: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" pending={pending}>
      {pending ? 'Reading it…' : again ? 'Read it again' : 'Read it for the map'}
    </Button>
  );
}

function AcceptButton({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" pending={pending} disabled={disabled}>
      {pending ? 'Saving…' : label}
    </Button>
  );
}

export function MapReview({ notePath }: { notePath: string }) {
  const [state, propose] = useActionState<ProposeMapState, FormData>(proposeMap, {});
  const [discarded, setDiscarded] = useState<NoteMapProposal | null>(null);

  const proposal = state.proposal && state.proposal !== discarded ? state.proposal : null;

  return (
    <section aria-labelledby="map-heading" className="mt-10">
      <h2 id="map-heading" className="text-body font-semibold text-ink">
        Map
      </h2>

      {proposal ? (
        <Review
          key={`${proposal.noteId}:${proposal.blobSha}:${proposal.positions.length}`}
          notePath={notePath}
          proposal={proposal}
          onDiscard={() => setDiscarded(proposal)}
        />
      ) : (
        <form action={propose} className="mt-2">
          <input type="hidden" name="notePath" value={notePath} />
          {/* The first visit is where this is read, so it says what pressing
              the button does and what it costs nobody: nothing is written. */}
          <p className="text-ui text-ink-muted">
            Proposes the themes this note covers and the positions it argues, each with the
            sentence it came from. Nothing is saved until you accept it.
          </p>
          {state.message && <p className="mt-2 text-ui text-ink">{state.message}</p>}
          {state.error && <p className="mt-2 text-ui text-caution">{state.error}</p>}
          <div className="mt-3 flex items-center gap-3">
            <ReadButton again={Boolean(state.message || state.error || discarded)} />
            <PaidHint
              action="app/vault/n/[...path]/actions.ts#proposeMap"
              what="Cost of reading the note"
            />
          </div>
        </form>
      )}
    </section>
  );
}

function Review({
  notePath,
  proposal,
  onDiscard,
}: {
  notePath: string;
  proposal: NoteMapProposal;
  onDiscard: () => void;
}) {
  const [state, accept] = useActionState<AcceptMapState, FormData>(acceptMap, {});
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(allKeys(proposal)));

  const full: NoteMap = useMemo(
    () => ({ themes: proposal.themes, positions: proposal.positions, edges: proposal.edges }),
    [proposal],
  );
  const { map: kept, unplaced } = useMemo(() => keepTickedMap(full, ticked), [full, ticked]);
  const unplacedKeys = new Set(unplaced.map((position) => position.key));
  const keptPositions = new Set(kept.positions.map((position) => position.key));

  const themeName = new Map(proposal.themes.map((theme) => [theme.key, theme.name]));
  const positionName = new Map(proposal.positions.map((p) => [p.key, p.name]));

  const toggle = (key: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Accepted: the proposal has done its job, and the screen says what landed
  // rather than leaving ticks that would write the same rows a second time.
  if (state.added) {
    return <p className="mt-2 text-ui text-ink">{state.added}</p>;
  }

  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const label = `Add ${count(kept.themes.length, 'theme', 'themes')} and ${count(
    kept.positions.length,
    'position',
    'positions',
  )}`;

  return (
    <form action={accept} className="mt-2">
      <input type="hidden" name="notePath" value={notePath} />
      <input type="hidden" name="blobSha" value={proposal.blobSha} />
      <input type="hidden" name="map" value={JSON.stringify(full)} />

      <p className="text-ui text-ink-muted">
        Read as {proposal.verdict.noteClass}
        {proposal.verdict.isEvidence ? ', and as evidence of what somebody was taught' : ''}.{' '}
        {proposal.verdict.reason} Untick anything it got wrong.
      </p>

      {proposal.themes.length > 0 && (
        <>
          <h3 className="mt-5 mb-2 text-ui font-medium text-ink">Themes</h3>
          <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
            {proposal.themes.map((theme) => (
              <TickRow
                key={theme.key}
                value={theme.key}
                label={`Keep the theme ${theme.name}`}
                ticked={ticked.has(theme.key)}
                onToggle={() => toggle(theme.key)}
              >
                <span className="block text-body font-medium text-ink">{theme.name}</span>
                <span className="mt-0.5 block text-ui text-ink-muted">{theme.about}</span>
              </TickRow>
            ))}
          </ul>
        </>
      )}

      {proposal.positions.length > 0 && (
        <>
          <h3 className="mt-5 mb-2 text-ui font-medium text-ink">Positions</h3>
          <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
            {proposal.positions.map((position) => (
              <TickRow
                key={position.key}
                value={position.key}
                label={`Keep the position ${position.name}`}
                ticked={ticked.has(position.key)}
                onToggle={() => toggle(position.key)}
              >
                <MapPosition
                  name={position.name}
                  statement={position.statement}
                  kind={position.kind}
                  stance={position.stance}
                  quote={position.quote}
                  under={position.themes.map((key) => themeName.get(key) ?? key)}
                  basis={position.basis}
                  tag={unplacedKeys.has(position.key) ? 'No ticked theme to sit under' : null}
                />
              </TickRow>
            ))}
          </ul>
        </>
      )}

      {proposal.edges.length > 0 && (
        <>
          <h3 className="mt-5 mb-2 text-ui font-medium text-ink">Links between positions</h3>
          <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
            {proposal.edges.map((edge) => {
              const key = edgeKey(edge);
              // An edge whose end is unticked is not written, so its tick is
              // shown off rather than left saying it will be.
              const ends = keptPositions.has(edge.from) && keptPositions.has(edge.to);
              return (
                <TickRow
                  key={key}
                  value={key}
                  label={`Keep the link from ${positionName.get(edge.from)} to ${positionName.get(edge.to)}`}
                  ticked={ticked.has(key) && ends}
                  disabled={!ends}
                  onToggle={() => toggle(key)}
                >
                  <span className="block text-ui text-ink">
                    <span className="font-medium">{positionName.get(edge.from)}</span>{' '}
                    {EDGE_VERB[edge.type]}{' '}
                    <span className="font-medium">{positionName.get(edge.to)}</span>
                  </span>
                  {edge.description && (
                    <span className="mt-0.5 block text-small text-ink-muted">
                      {edge.description}
                    </span>
                  )}
                </TickRow>
              );
            })}
          </ul>
        </>
      )}

      <Omissions proposal={proposal} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <AcceptButton
          label={label}
          disabled={kept.themes.length === 0 && kept.positions.length === 0}
        />
        {/* Each theme and position kept is embedded as it is saved. */}
        <PaidHint
          action="app/vault/n/[...path]/actions.ts#acceptMap"
          count={kept.themes.length + kept.positions.length}
          what="Cost of adding them"
        />
        {/* Writes nothing: the proposal is thrown away and the read button
            comes back. */}
        <Button type="button" variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
        {state.error && <span className="text-ui text-caution">{state.error}</span>}
      </div>
    </form>
  );
}

function TickRow({
  value,
  label,
  ticked,
  disabled,
  onToggle,
  children,
}: {
  value: string;
  label: string;
  ticked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <input
        type="checkbox"
        name="keep"
        value={value}
        checked={ticked}
        disabled={disabled}
        onChange={onToggle}
        aria-label={label}
        className="mt-1 size-4 shrink-0 rounded border-border text-accent focus:ring-accent/30"
      />
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

/**
 * What the reading left out, said where the proposal is. A position dropped
 * because its quote was not in the note, or a section whose call failed, is
 * the difference between a whole reading and a partial one, and nothing else
 * on the page would show it.
 */
function Omissions({ proposal }: { proposal: NoteMapProposal }) {
  const missingQuote = proposal.dropped.filter((d) => d.why === 'quote-missing');
  const noTheme = proposal.dropped.filter((d) => d.why === 'no-theme');
  const lines: string[] = [];

  if (missingQuote.length > 0) {
    lines.push(
      `Left out because the quote given is not in the note: ${missingQuote.map((d) => d.name).join(', ')}.`,
    );
  }
  if (noTheme.length > 0) {
    lines.push(
      `Left out because no theme was given to hold them: ${noTheme.map((d) => d.name).join(', ')}.`,
    );
  }
  for (const failed of proposal.chunks.failed) {
    lines.push(`The section "${failed.title}" was not read: ${failed.detail}`);
  }
  for (const skip of proposal.skipped) lines.push(skip.detail);

  if (lines.length === 0) return null;
  return (
    <div className="mt-3 space-y-1 text-small text-ink-muted">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
