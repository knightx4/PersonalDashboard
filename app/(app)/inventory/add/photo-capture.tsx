'use client';

import { useActionState, useRef, useState } from 'react';
import { extractBooksFromPhoto } from './photo-actions';
import { savePasteBookList, type BookActionState } from './actions';
import { Button } from '@/components/ui/button';
import { FieldError, Label } from '@/components/ui/field';
import {
  PHOTO_ACCEPT,
  preparePhoto,
  UnsupportedImageError,
} from '@/lib/images/prepare-photo';
import type { CanonicalBook } from '@/lib/books/types';

/**
 * Shelf / cover photo capture. Image is sent to a server action, extracted,
 * resolved, then discarded — nothing is written until the user confirms.
 */
export function PhotoCapturePanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<'shelf' | 'cover'>('shelf');
  const [preview, setPreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [extractState, extractAction, extractPending] = useActionState(
    extractBooksFromPhoto,
    {} as BookActionState,
  );
  const [saveState, saveAction, savePending] = useActionState(
    savePasteBookList,
    {} as BookActionState,
  );

  async function onFileChange(file: File | null) {
    if (!file) return;
    setImageError(null);
    try {
      // Converts HEIC, applies EXIF rotation, and shrinks the original.
      const { dataUrl } = await preparePhoto(file);
      setPreview(dataUrl);
    } catch (err) {
      setPreview(null);
      setImageError(
        err instanceof UnsupportedImageError
          ? err.message
          : 'Could not read that photo. Try another one.',
      );
    }
  }

  function runExtract() {
    if (!preview) return;
    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('image_data_url', preview);
    extractAction(fd);
  }

  const resolved = (extractState.results ?? [])
    .map((row, index) => ({ row, index }))
    .filter((e) => Boolean(e.row.book));
  const booksPayload: CanonicalBook[] = resolved.map((e) => e.row.book!);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Photos are processed and discarded. Any phone photo works, iPhone HEIC
        included. You must confirm the detected list before anything is saved —
        spine OCR is never trusted blindly.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={kind === 'shelf' ? 'primary' : 'secondary'}
          onClick={() => setKind('shelf')}
        >
          Shelf (bulk)
        </Button>
        <Button
          type="button"
          size="sm"
          variant={kind === 'cover' ? 'primary' : 'secondary'}
          onClick={() => setKind('cover')}
        >
          Cover / back ISBN
        </Button>
      </div>

      <div>
        <Label htmlFor="photo">Photo</Label>
        <input
          ref={fileRef}
          id="photo"
          type="file"
          accept={PHOTO_ACCEPT}
          className="block w-full text-sm text-ink-muted"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
      </div>

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Upload preview"
          className="max-h-64 w-full rounded-xl border border-border object-contain bg-canvas"
        />
      )}

      <Button
        type="button"
        disabled={!preview || extractPending}
        onClick={runExtract}
        className="self-start"
      >
        {extractPending ? 'Reading photo…' : 'Detect books'}
      </Button>

      <FieldError>{imageError ?? extractState.error ?? saveState.error}</FieldError>
      {extractState.message && (
        <p className="text-sm text-ink-muted">{extractState.message}</p>
      )}
      {saveState.message && <p className="text-sm text-brand">{saveState.message}</p>}

      {extractState.results && extractState.results.length > 0 && (
        <form action={saveAction} className="flex flex-col gap-3">
          <input type="hidden" name="books_json" value={JSON.stringify(booksPayload)} />
          <input type="hidden" name="source" value="photo" />
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {extractState.results.map((row, resultIndex) => {
              if (!row.book) {
                return (
                  <li key={resultIndex} className="px-4 py-3 text-sm text-ink-muted">
                    <span className="font-medium text-ink">{row.raw}</span>
                    <span className="ml-2 text-red-600">{row.error ?? 'No match'}</span>
                  </li>
                );
              }
              const payloadIndex = resolved.findIndex((e) => e.index === resultIndex);
              return (
                <li key={resultIndex} className="flex items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    name="selected"
                    value={String(payloadIndex)}
                    defaultChecked={false}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{row.book.title}</p>
                    <p className="text-[13px] text-ink-muted">
                      {row.book.authors.join(', ')}
                      {row.book.isbn13 ? ` · ${row.book.isbn13}` : ''}
                    </p>
                    <label className="mt-2 flex items-center gap-2 text-[13px] text-accent-orange">
                      <input
                        type="checkbox"
                        name="confirmed"
                        value={String(payloadIndex)}
                        defaultChecked={!row.book.needsConfirmation}
                      />
                      Confirm this edition
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
          <Button
            type="submit"
            disabled={savePending || booksPayload.length === 0}
            className="self-start"
          >
            {savePending ? 'Saving…' : 'Save confirmed selections'}
          </Button>
        </form>
      )}
    </div>
  );
}
