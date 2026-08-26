'use client';

import { useActionState, useRef, useState } from 'react';
import Link from 'next/link';
import { extractGamesFromPhoto, saveGameBatch, type GameActionState } from './actions';
import { gameSubtitle } from './game-forms';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';

const MAX_EDGE = 1600;

/** Downscale in the browser so a 12MP phone photo fits the request budget. */
async function fileToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function GameShelfPhotoPanel() {
  const [readState, readAction, readPending] = useActionState(
    extractGamesFromPhoto,
    {} as GameActionState,
  );
  const [saveState, saveAction, savePending] = useActionState(
    saveGameBatch,
    {} as GameActionState,
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      setPreview(dataUrl);
      const fd = new FormData();
      fd.set('image_data_url', dataUrl);
      readAction(fd);
    } catch {
      setError('Could not read that image. Try a JPEG or PNG.');
    }
  }

  const rows = readState.rows ?? [];
  const matched = rows.filter((row) => row.game);
  const unmatched = rows.filter((row) => !row.game);
  // Payload indexes must line up with the checkbox values.
  const payload = matched.map((row) => row.game!);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-ink-muted">
          Photograph the whole stack. Every box it can read becomes a row you tick
          before saving; boxes it cannot read are counted, not silently dropped.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <Button type="button" onClick={() => inputRef.current?.click()} disabled={readPending}>
          {readPending ? 'Reading photo…' : 'Choose or take a photo'}
        </Button>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element -- local data URL
          <img src={preview} alt="" className="h-16 w-16 rounded object-cover" />
        )}
      </div>

      <FieldError>{error ?? readState.error ?? saveState.error}</FieldError>
      {readState.message && <p className="text-sm text-ink">{readState.message}</p>}
      {readState.notes && (
        <p className="text-[13px] text-ink-muted">Note from the read: {readState.notes}</p>
      )}
      {saveState.message && <p className="text-sm text-brand">{saveState.message}</p>}

      {(readState.unreadableCount ?? 0) > 0 && (
        <div className="rounded-lg border border-accent-orange/30 bg-accent-orange/5 px-3 py-2 text-[13px] text-ink">
          {readState.unreadableCount} box(es) were visible but not identifiable —
          turned away, hidden, or cut off. Re-shoot that part of the shelf, or add
          those by hand.
        </div>
      )}

      {matched.length > 0 && (
        <form action={saveAction} className="flex flex-col gap-3">
          <input type="hidden" name="games_json" value={JSON.stringify(payload)} />
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {matched.map((row, index) => {
              const game = row.game!;
              return (
                <li key={`${game.bggId ?? game.title}-${index}`} className="flex gap-3 px-4 py-3">
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
                    <p className="text-[13px] text-ink-muted">{gameSubtitle(game)}</p>
                    <p className="text-[12px] text-ink-faint">
                      Read as “{row.raw}”
                      {row.sighting?.confidence
                        ? ` · photo confidence ${row.sighting.confidence}`
                        : ''}
                      {game.needsConfirmation ? ' · needs a look' : ''}
                    </p>
                    {row.sighting?.note && (
                      <p className="text-[12px] text-accent-orange">{row.sighting.note}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <Button type="submit" disabled={savePending} className="self-start">
            {savePending ? 'Saving…' : 'Add ticked games'}
          </Button>
          {saveState.savedIds && saveState.savedIds.length > 0 && (
            <Link href="/inventory" className="text-[13px] text-brand underline">
              View inventory
            </Link>
          )}
        </form>
      )}

      {unmatched.length > 0 && (
        <div>
          <p className="text-sm font-medium text-ink">
            Read but not matched ({unmatched.length})
          </p>
          <p className="text-[13px] text-ink-muted">
            The photo gave a name, BoardGameGeek did not confirm it. Add these by hand
            or search for them.
          </p>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">
            {unmatched.map((row, index) => (
              <li key={`${row.raw}-${index}`} className="px-4 py-2 text-[13px]">
                <span className="text-ink">{row.raw}</span>
                {row.error && <span className="ml-2 text-accent-orange">{row.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
