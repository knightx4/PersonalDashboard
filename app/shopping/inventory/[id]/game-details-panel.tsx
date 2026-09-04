'use client';

import { useActionState } from 'react';
import {
  confirmGameEdition,
  switchGameEdition,
  type GameActionState,
} from '@/app/shopping/inventory/add/games/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import type { GameEditionCandidate } from '@/lib/games/types';

export type GameDetailsView = {
  inventoryItemId: string;
  title: string;
  imageUrl: string | null;
  bggId: number | null;
  yearPublished: number | null;
  publisher: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTimeMinutes: number | null;
  needsConfirmation: boolean;
  confirmationReason: string | null;
  candidates: GameEditionCandidate[];
  autoImported: boolean;
  matchConfidence: number | null;
  resolutionSource: string;
};

const SOURCE_LABEL: Record<string, string> = {
  bgg: 'BoardGameGeek',
  wikidata: 'Wikidata',
  upc_lookup: 'a barcode lookup',
  manual: 'entered by hand',
};

function Fact({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className={value ? 'text-ink' : 'text-ink-muted'}>{value || 'Not listed'}</dd>
    </div>
  );
}

function playerLine(game: { minPlayers: number | null; maxPlayers: number | null }): string | null {
  if (game.minPlayers == null && game.maxPlayers == null) return null;
  if (game.minPlayers != null && game.maxPlayers != null) {
    return game.minPlayers === game.maxPlayers
      ? `${game.minPlayers}`
      : `${game.minPlayers}–${game.maxPlayers}`;
  }
  return String(game.minPlayers ?? game.maxPlayers);
}

function boxLine(game: { publisher: string | null; yearPublished: number | null }): string {
  const parts = [game.publisher, game.yearPublished].filter(Boolean).map(String);
  return parts.length > 0 ? parts.join(' · ') : 'Box not stated by the catalog';
}

function CandidateRow({
  inventoryItemId,
  candidate,
}: {
  inventoryItemId: string;
  candidate: GameEditionCandidate;
}) {
  const [state, action, pending] = useActionState(switchGameEdition, {} as GameActionState);

  return (
    <li className="flex gap-3 px-3 py-3">
      {candidate.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary catalog CDNs
        <img
          src={candidate.imageUrl}
          alt=""
          className="h-16 w-16 shrink-0 rounded bg-canvas object-cover"
        />
      ) : (
        <div className="h-16 w-16 shrink-0 rounded bg-canvas" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-ink">{candidate.title}</p>
        <p className="text-ui text-ink-muted">{boxLine(candidate)}</p>
        {candidate.bggId != null && (
          <p className="font-mono text-small text-ink-muted">BGG {candidate.bggId}</p>
        )}
        <form action={action} className="mt-2">
          <input type="hidden" name="inventory_item_id" value={inventoryItemId} />
          <input type="hidden" name="candidate_json" value={JSON.stringify(candidate)} />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? 'Switching…' : 'This is my box'}
          </Button>
        </form>
        <FieldError>{state.error}</FieldError>
      </div>
    </li>
  );
}

/**
 * A game's identity, and the confirmation gate that pricing waits on.
 *
 * The gate used to live only on the sell assistant, which meant the item page
 * could tell you a game needed confirming and then send you somewhere else to
 * do it. Books already answered that question on their own page; games now do
 * too, so an item is priced entirely from the page you are standing on.
 *
 * This is the top of the item's one Details box rather than a box of its own —
 * it carries no heading and no chrome, because "Details" and "Game details"
 * side by side asked the reader to work out which of two panels a fact was in.
 *
 * Players and playing time are rendered only when the catalog has them: the
 * category template carries fields for the same two facts, and the page hides
 * whichever of the pair is the duplicate.
 */
export function GameDetailsPanel({ game }: { game: GameDetailsView }) {
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmGameEdition,
    {} as GameActionState,
  );

  const players = playerLine(game);

  return (
    <div className="space-y-4">
      {game.autoImported && (
        <p className="text-small text-ink-muted">Imported from an order email</p>
      )}

      <dl className="grid gap-2 text-body sm:grid-cols-2">
        <Fact label="BGG id" value={game.bggId} />
        <Fact label="Publisher" value={game.publisher} />
        <Fact label="Year" value={game.yearPublished} />
        {players != null && <Fact label="Players" value={players} />}
        {game.playingTimeMinutes != null && (
          <Fact label="Playing time" value={`${game.playingTimeMinutes} min`} />
        )}
        <div>
          <dt className="text-ink-muted">Resolved via</dt>
          <dd className="text-ink">
            {SOURCE_LABEL[game.resolutionSource] ?? game.resolutionSource.replace('_', ' ')}
            {game.matchConfidence != null
              ? ` · ${Math.round(Number(game.matchConfidence) * 100)}% match`
              : ''}
          </dd>
        </div>
      </dl>

      {game.needsConfirmation && (
        <div className="space-y-3 rounded-lg border border-caution/30 bg-caution-fill/5 p-3">
          <div>
            <h3 className="text-body font-semibold text-ink">Which box is on your shelf?</h3>
            <p className="mt-1 text-ui text-ink-muted">
              {game.confirmationReason ??
                'We could not pin this to a single edition, and asking prices differ a lot between them.'}{' '}
              Answer here and this game can be priced.
            </p>
          </div>

          <div className="flex gap-3 rounded-lg border border-border bg-surface p-3">
            {game.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary catalog CDNs
              <img
                src={game.imageUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded bg-canvas object-cover"
              />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded bg-canvas" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-micro font-semibold uppercase tracking-wide text-ink-muted">
                Our best guess
              </p>
              <p className="text-body font-medium text-ink">{game.title}</p>
              <p className="text-ui text-ink-muted">{boxLine(game)}</p>
              {game.bggId != null && (
                <p className="font-mono text-small text-ink-muted">BGG {game.bggId}</p>
              )}
              <form action={confirmAction} className="mt-2">
                <input type="hidden" name="inventory_item_id" value={game.inventoryItemId} />
                <Button type="submit" size="sm" disabled={confirmPending}>
                  {confirmPending ? 'Saving…' : 'This is the right box'}
                </Button>
              </form>
              <FieldError>{confirmState.error}</FieldError>
              {confirmState.message && (
                <p className="mt-1 text-ui text-accent">{confirmState.message}</p>
              )}
            </div>
          </div>

          {game.candidates.length > 0 && (
            <div>
              <p className="mb-1 text-ui font-medium text-ink">Other editions we found</p>
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {game.candidates.map((candidate, index) => (
                  <CandidateRow
                    key={candidate.bggId ?? `${candidate.title}-${index}`}
                    inventoryItemId={game.inventoryItemId}
                    candidate={candidate}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
