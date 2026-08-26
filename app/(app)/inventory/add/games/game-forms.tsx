'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import {
  saveGame,
  saveManualGame,
  searchGame,
  type GameActionState,
} from './actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/field';
import type { CanonicalGame } from '@/lib/games/types';

export function gameSubtitle(game: {
  publisher: string | null;
  yearPublished: number | null;
  minPlayers?: number | null;
  maxPlayers?: number | null;
}): string {
  const players =
    game.minPlayers && game.maxPlayers ? `${game.minPlayers}–${game.maxPlayers} players` : null;
  return (
    [game.publisher, game.yearPublished, players].filter(Boolean).join(' · ') ||
    'No publisher or year on record'
  );
}

export function GameCard({
  game,
  onSave,
  onPick,
  pending,
}: {
  game: CanonicalGame;
  onSave: (forceConfirmed: boolean) => void;
  onPick?: (game: CanonicalGame) => void;
  pending: boolean;
}) {
  return (
    <div className="flex gap-4 rounded-xl border border-border bg-surface p-4">
      {game.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- BGG CDN
        <img
          src={game.imageUrl}
          alt=""
          className="h-24 w-24 shrink-0 rounded-md object-cover bg-canvas"
        />
      ) : (
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-md bg-canvas text-xs text-ink-faint">
          No image
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{game.title}</p>
        <p className="text-sm text-ink-muted">{gameSubtitle(game)}</p>
        {game.bggId && (
          <p className="mt-1 text-[12px] text-ink-faint">BGG #{game.bggId}</p>
        )}
        {game.needsConfirmation ? (
          <p className="mt-2 text-[13px] text-accent-orange">
            {game.confirmationReason ??
              'More than one edition matches — confirm before this drives a sell decision.'}
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-brand">
            Confident match ({Math.round(game.matchConfidence * 100)}%).
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={() => onSave(true)}>
            {game.needsConfirmation ? 'Yes — this box' : 'Add to collection'}
          </Button>
          {game.needsConfirmation && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => onSave(false)}
            >
              Save, confirm later
            </Button>
          )}
        </div>

        {game.needsConfirmation && (game.alternates?.length ?? 0) > 0 && (
          <div className="mt-3">
            <p className="text-[13px] font-medium text-ink">Other editions on BGG</p>
            <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
              {game.alternates?.map((candidate, index) => (
                <li
                  key={candidate.bggId ?? `${candidate.title}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink">{candidate.title}</p>
                    <p className="text-[12px] text-ink-muted">{gameSubtitle(candidate)}</p>
                  </div>
                  {onPick && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        onPick({
                          ...game,
                          bggId: candidate.bggId,
                          title: candidate.title,
                          yearPublished: candidate.yearPublished,
                          publisher: candidate.publisher,
                          imageUrl: candidate.imageUrl,
                          matchConfidence: 1,
                          needsConfirmation: false,
                          alternates: [],
                          confirmationReason: null,
                        })
                      }
                    >
                      This one
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function AddGameManualForm({
  barcode,
  compact,
}: {
  barcode?: string | null;
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveManualGame,
    {} as GameActionState,
  );

  return (
    <form
      action={action}
      className={
        compact
          ? 'flex flex-col gap-3 rounded-xl border border-border bg-surface p-4'
          : 'flex flex-col gap-3'
      }
    >
      {compact && (
        <p className="text-sm font-medium text-ink">Add it by hand</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="game_title">Title</Label>
          <Input id="game_title" name="title" required autoComplete="off" />
        </div>
        <div>
          <Label htmlFor="game_publisher">Publisher</Label>
          <Input id="game_publisher" name="publisher" autoComplete="off" />
        </div>
        <div>
          <Label htmlFor="game_year">Year</Label>
          <Input id="game_year" name="year_published" inputMode="numeric" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="game_barcode">Barcode</Label>
          <Input
            id="game_barcode"
            name="barcode"
            defaultValue={barcode ?? ''}
            placeholder="UPC or EAN from the box"
            autoComplete="off"
          />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Saving…' : 'Add to collection'}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && (
        <p className="text-sm text-brand">
          {state.message}{' '}
          {state.savedIds?.[0] && (
            <Link className="underline" href={`/inventory/${state.savedIds[0]}`}>
              View item
            </Link>
          )}
        </p>
      )}
    </form>
  );
}

export function GameSearchForm() {
  const [searchState, searchAction, searchPending] = useActionState(
    searchGame,
    {} as GameActionState,
  );
  const [saveState, saveAction, savePending] = useActionState(
    saveGame,
    {} as GameActionState,
  );
  const [picked, setPicked] = useState<CanonicalGame | null>(null);
  const shown = picked ?? searchState.game ?? null;

  function save(forceConfirmed: boolean) {
    if (!shown) return;
    const fd = new FormData();
    fd.set('game_json', JSON.stringify(shown));
    fd.set('force_confirmed', forceConfirmed ? 'true' : 'false');
    saveAction(fd);
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        action={searchAction}
        onSubmit={() => setPicked(null)}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <Label htmlFor="game_query">Game name or barcode</Label>
          <Input
            id="game_query"
            name="query"
            placeholder="Wingspan, or 0810011725195"
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={searchPending}>
          {searchPending ? 'Searching…' : 'Search'}
        </Button>
      </form>
      <FieldError>{searchState.error ?? saveState.error}</FieldError>
      {saveState.message && (
        <p className="text-sm text-brand">
          {saveState.message}{' '}
          {saveState.savedIds?.[0] && (
            <Link className="underline" href={`/inventory/${saveState.savedIds[0]}`}>
              View item
            </Link>
          )}
        </p>
      )}
      {shown && (
        <GameCard game={shown} onSave={save} onPick={setPicked} pending={savePending} />
      )}
      {!shown && searchState.error && (
        <AddGameManualForm compact barcode={searchState.manualBarcode} />
      )}
    </div>
  );
}
