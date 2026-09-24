'use client';

import { useActionState, useRef, useState } from 'react';
import Link from 'next/link';
import {
  extractGamesFromPhoto,
  saveGameBatch,
  saveUnmatchedGames,
  type GameActionState,
  type ShelfRow,
} from './actions';
import { gameSubtitle } from './game-forms';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { FieldError } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import {
  PHOTO_ACCEPT,
  preparePhoto,
  UnsupportedImageError,
} from '@/lib/images/prepare-photo';
import { PaidHint } from '@/components/ui/paid-hint';

/** Overlapping shots of one shelf see the same box twice. */
function rowKey(row: ShelfRow): string {
  if (row.game?.bggId) return `bgg-${row.game.bggId}`;
  return (row.game?.title ?? row.raw).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

type ReadProgress = { done: number; total: number } | null;

export function GameShelfPhotoPanel() {
  const [saveState, saveAction, savePending] = useActionState(
    saveGameBatch,
    {} as GameActionState,
  );
  const [byNameState, byNameAction, byNamePending] = useActionState(
    saveUnmatchedGames,
    {} as GameActionState,
  );
  const [rows, setRows] = useState<ShelfRow[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [photosRead, setPhotosRead] = useState(0);
  const [progress, setProgress] = useState<ReadProgress>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Photos are read one at a time and merged, so several angles of a big
   * shelf add up into one list instead of replacing each other.
   */
  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const list = Array.from(files);
    setProgress({ done: 0, total: list.length });

    for (const [index, file] of list.entries()) {
      try {
        // HEIC, EXIF rotation, and 12MP originals are all handled here.
        const { dataUrl } = await preparePhoto(file);
        setPreviews((prev) => [...prev, dataUrl]);

        const fd = new FormData();
        fd.set('image_data_url', dataUrl);
        const result = await extractGamesFromPhoto({}, fd);

        if (result.error) {
          setError(result.error);
        } else {
          setRows((prev) => {
            const seen = new Set(prev.map(rowKey));
            const fresh = (result.rows ?? []).filter((row) => !seen.has(rowKey(row)));
            return [...prev, ...fresh];
          });
          setUnreadable((prev) => prev + (result.unreadableCount ?? 0));
          setPhotosRead((prev) => prev + 1);
        }
      } catch (err) {
        // Name the file and the actual reason — "try another photo" taught us
        // nothing the last time this fired.
        setError(
          err instanceof UnsupportedImageError
            ? err.message
            : `Could not read ${file.name || 'one of those images'}: ${
                err instanceof Error ? err.message : String(err)
              }`,
        );
      }
      setProgress({ done: index + 1, total: list.length });
    }

    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function reset() {
    setRows([]);
    setUnreadable(0);
    setPhotosRead(0);
    setPreviews([]);
    setError(null);
  }

  const matched = rows.filter((row) => row.game);
  const unmatched = rows.filter((row) => !row.game);
  // Every unmatched row carries the same provider failure; say it once.
  const unmatchedError = unmatched.find((row) => row.error)?.error ?? null;
  // Payload indexes must line up with the checkbox values.
  const payload = matched.map((row) => row.game!);
  const reading = progress !== null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-ink-muted">
        Pick photos from your library or take new ones — straight off an iPhone
        is fine, no converting. Several shots of a big shelf merge into one
        list, a box seen twice is listed once, and every readable box becomes a
        row you tick before saving.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept={PHOTO_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => onPick(e.target.files)}
        />
        <Button type="button" onClick={() => inputRef.current?.click()} disabled={reading}>
          {reading
            ? `Reading photo ${progress.done + 1} of ${progress.total}…`
            : rows.length > 0
              ? 'Add more photos'
              : 'Choose photos'}
        </Button>
        <PaidHint
          action="app/shopping/inventory/add/games/actions.ts#extractGamesFromPhoto"
          what="Cost of reading each photo"
        />
        {rows.length > 0 && !reading && (
          <Button type="button" variant="ghost" size="sm" onClick={reset}>
            Start over
          </Button>
        )}
      </div>

      {previews.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {previews.map((src, index) => (
            // eslint-disable-next-line @next/next/no-img-element -- local data URL
            <img key={index} src={src} alt="" className="h-14 w-14 rounded object-cover" />
          ))}
        </div>
      )}

      <FieldError>{error ?? saveState.error}</FieldError>

      {photosRead > 0 && (
        <p className="text-body text-ink">
          Read {photosRead} photo{photosRead === 1 ? '' : 's'} · matched {matched.length} of{' '}
          {rows.length} box{rows.length === 1 ? '' : 'es'}.
        </p>
      )}
      {saveState.message && <p className="text-body text-accent">{saveState.message}</p>}

      {/* A box the photo could see and not read is the page failing to tell
          you the whole truth, and only you can fix it: that is the warn
          Banner, not a hand-rolled caution box a shade off it. Law 2. */}
      {unreadable > 0 && (
        <Banner tone="warn">
          {unreadable} box(es) were visible but not identifiable — turned away, hidden,
          or cut off. Re-shoot that part of the shelf, or add those by hand.
        </Banner>
      )}

      {matched.length > 0 && (
        <form action={saveAction} className="flex flex-col gap-3">
          <input type="hidden" name="games_json" value={JSON.stringify(payload)} />
          {/* The read shelf is the result the page exists for: one card, with
              divides inside it and rows on the density dial, rather than a
              hand-drawn box. Law 11. */}
          <ul className={cn(cardVariants({ padding: 'none' }), 'divide-y divide-border')}>
            {matched.map((row, index) => {
              const game = row.game!;
              return (
                <li
                  key={`${game.bggId ?? game.title}-${index}`}
                  className="card-pad-x row-pad flex gap-3"
                >
                  <input
                    type="checkbox"
                    name="selected"
                    value={String(index)}
                    defaultChecked={!game.needsConfirmation}
                    className="mt-1"
                  />
                  {game.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- BGG CDN
                    <img
                      src={game.imageUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded object-cover bg-canvas"
                    />
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded bg-canvas" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{game.title}</p>
                    <p className="text-ui text-ink-muted">{gameSubtitle(game)}</p>
                    <p className="text-small text-ink-muted">
                      Read as “{row.raw}”
                      {row.sighting?.confidence
                        ? ` · photo confidence ${row.sighting.confidence}`
                        : ''}
                      {game.needsConfirmation ? ' · needs a look' : ''}
                    </p>
                    {row.sighting?.note && (
                      <p className="text-small text-caution">{row.sighting.note}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <Button type="submit" disabled={savePending || reading} className="self-start">
            {savePending ? 'Saving…' : 'Add ticked games'}
          </Button>
          {saveState.savedIds && saveState.savedIds.length > 0 && (
            <Link href="/shopping/inventory" className="text-ui text-accent underline">
              View inventory
            </Link>
          )}
        </form>
      )}

      {unmatched.length > 0 && (
        <form action={byNameAction} className="flex flex-col gap-2">
          <input
            type="hidden"
            name="titles_json"
            value={JSON.stringify(unmatched.map((row) => row.raw))}
          />
          <p className="text-body font-medium text-ink">
            Read but not matched ({unmatched.length})
          </p>
          <p className="text-ui text-ink-muted">
            The photo read these names; BoardGameGeek did not confirm them. Save them
            as typed names now — the box is on your shelf either way — and attach a
            BGG id later from the item page.
          </p>
          {unmatchedError && (
            <p className="text-ui text-caution">{unmatchedError}</p>
          )}
          <ul className={cn(cardVariants({ padding: 'none' }), 'divide-y divide-border')}>
            {unmatched.map((row, index) => (
              <li key={`${row.raw}-${index}`} className="card-pad-x row-pad flex gap-3 text-ui">
                <input
                  type="checkbox"
                  name="selected"
                  value={String(index)}
                  defaultChecked
                  className="mt-0.5"
                />
                <span className="text-ink">{row.raw}</span>
              </li>
            ))}
          </ul>
          <Button
            type="submit"
            variant="secondary"
            disabled={byNamePending || reading}
            className="self-start"
          >
            {byNamePending
              ? 'Saving…'
              : `Add ${unmatched.length} ticked as typed names`}
          </Button>
          <FieldError>{byNameState.error}</FieldError>
          {byNameState.message && (
            <p className="text-ui text-accent">{byNameState.message}</p>
          )}
        </form>
      )}
    </div>
  );
}
