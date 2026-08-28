'use client';

import { useActionState, useState } from 'react';
import {
  previewReceiptPhoto,
  saveReceiptPhotoOrder,
  type ReceiptActionState,
} from './actions';
import { Button } from '@/components/ui/button';
import { FieldError, Label } from '@/components/ui/field';
import {
  PHOTO_ACCEPT,
  preparePhoto,
  UnsupportedImageError,
} from '@/lib/images/prepare-photo';
import { formatMoney } from '@/lib/money';

export function ReceiptPhotoForm() {
  const [preview, setPreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [previewState, previewAction, previewPending] = useActionState(
    previewReceiptPhoto,
    {} as ReceiptActionState,
  );
  const [saveState, saveAction, savePending] = useActionState(
    saveReceiptPhotoOrder,
    {} as ReceiptActionState,
  );

  async function onFile(file: File | null) {
    if (!file) return;
    setImageError(null);
    try {
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

  function runPreview() {
    if (!preview) return;
    const fd = new FormData();
    fd.set('image_data_url', preview);
    previewAction(fd);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Photograph a paper receipt. We extract an order the same way as email
        import, then attach book details when lines look like books.
      </p>
      <div>
        <Label htmlFor="receipt">Receipt photo</Label>
        <input
          id="receipt"
          type="file"
          accept={PHOTO_ACCEPT}
          className="block w-full text-sm"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </div>
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Receipt preview"
          className="max-h-72 w-full rounded-xl border border-border object-contain bg-canvas"
        />
      )}
      <Button
        type="button"
        disabled={!preview || previewPending}
        onClick={runPreview}
        className="self-start"
      >
        {previewPending ? 'Reading…' : 'Extract order'}
      </Button>
      <FieldError>{imageError ?? previewState.error ?? saveState.error}</FieldError>

      {previewState.preview && previewState.rawOrder && (
        <form action={saveAction} className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <input type="hidden" name="raw_order" value={previewState.rawOrder} />
          <p className="text-sm font-medium text-ink">
            {previewState.preview.merchantName ?? 'Unknown merchant'} ·{' '}
            {previewState.preview.orderDate} ·{' '}
            {formatMoney(previewState.preview.totalCents)}
          </p>
          <ul className="divide-y divide-border text-sm">
            {previewState.preview.lines.map((line, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span>
                  {line.name}
                  {line.quantity > 1 ? ` ×${line.quantity}` : ''}
                  {line.categorySlug ? (
                    <span className="ml-2 text-ink-faint">{line.categorySlug}</span>
                  ) : null}
                </span>
                <span className="tabular text-ink-muted">
                  {formatMoney(line.unitPriceCents)}
                </span>
              </li>
            ))}
          </ul>
          <Button type="submit" disabled={savePending}>
            {savePending ? 'Saving…' : 'Save as receipt order'}
          </Button>
        </form>
      )}
    </div>
  );
}
