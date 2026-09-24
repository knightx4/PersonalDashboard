'use client';

import { useActionState, useState } from 'react';
import {
  previewReceiptPhoto,
  saveReceiptPhotoOrder,
  type ReceiptActionState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Field, FieldError } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import {
  PHOTO_ACCEPT,
  preparePhoto,
  UnsupportedImageError,
} from '@/lib/images/prepare-photo';
import { formatMoney } from '@/lib/money';
import { PaidHint } from '@/components/ui/paid-hint';

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
      <p className="text-body text-ink-muted">
        Photograph a paper receipt. We extract an order the same way as email
        import, then attach book details when lines look like books.
      </p>
      {/* A file input keeps its native control; only the label is ours. */}
      <Field id="receipt" label="Receipt photo">
        <input
          id="receipt"
          type="file"
          accept={PHOTO_ACCEPT}
          className="block w-full text-body text-ink-muted"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      {preview && (
        <Card padding="none" className="overflow-hidden bg-canvas">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Receipt preview"
            className="max-h-72 w-full object-contain"
          />
        </Card>
      )}
      <div className="flex items-center gap-3">
        <Button type="button" disabled={!preview} pending={previewPending} onClick={runPreview}>
          {previewPending ? 'Reading…' : 'Extract order'}
        </Button>
        <PaidHint
          action="app/shopping/orders/receipt/actions.ts#previewReceiptPhoto"
          what="Cost of reading the receipt"
        />
      </div>
      <FieldError>{imageError ?? previewState.error ?? saveState.error}</FieldError>

      {previewState.preview && previewState.rawOrder && (
        <form action={saveAction} className={cn(cardVariants({ padding: 'dense' }), 'space-y-3')}>
          <input type="hidden" name="raw_order" value={previewState.rawOrder} />
          <p className="text-body font-medium text-ink">
            {previewState.preview.merchantName ?? 'Unknown merchant'} ·{' '}
            {previewState.preview.orderDate} ·{' '}
            {formatMoney(previewState.preview.totalCents)}
          </p>
          <ul className="divide-y divide-border text-body">
            {previewState.preview.lines.map((line, i) => (
              <li key={i} className="row-pad flex justify-between gap-3">
                <span>
                  {line.name}
                  {line.quantity > 1 ? ` ×${line.quantity}` : ''}
                  {line.categorySlug ? (
                    <span className="ml-2 text-ink-muted">{line.categorySlug}</span>
                  ) : null}
                </span>
                <span className="tabular text-ink-muted">
                  {formatMoney(line.unitPriceCents)}
                </span>
              </li>
            ))}
          </ul>
          <Button type="submit" pending={savePending}>
            {savePending ? 'Saving…' : 'Save as receipt order'}
          </Button>
        </form>
      )}
    </div>
  );
}
