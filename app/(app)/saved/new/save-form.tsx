'use client';

import { useActionState, useState } from 'react';
import {
  createSavedItem,
  previewSavedUrl,
  type ActionState,
  type PreviewState,
} from '@/app/(app)/saved/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, Textarea } from '@/components/ui/field';
import { formatMoney } from '@/lib/money';

const previewInitial: PreviewState = {};
const saveInitial: ActionState = {};

export function SaveForm() {
  const [preview, previewAction, previewPending] = useActionState(
    previewSavedUrl,
    previewInitial,
  );
  const [saveState, saveAction, savePending] = useActionState(createSavedItem, saveInitial);
  const [urlDraft, setUrlDraft] = useState('');

  const ready = Boolean(preview.url && !preview.error);
  const urlInputValue = urlDraft || preview.url || '';

  return (
    <div className="space-y-8">
      <form action={previewAction} className="space-y-3">
        <div>
          <Label htmlFor="url">Product URL</Label>
          <Input
            id="url"
            name="url"
            type="url"
            required
            placeholder="https://…"
            value={urlInputValue}
            onChange={(event) => setUrlDraft(event.target.value)}
            autoFocus
          />
          <p className="mt-1.5 text-[13px] text-ink-muted">
            We pull title, image and price from the page when we can. You can edit
            everything before saving.
          </p>
        </div>
        <Button type="submit" disabled={previewPending || !urlInputValue.trim()}>
          {previewPending ? 'Looking up…' : 'Look up'}
        </Button>
        <FieldError>{preview.error}</FieldError>
      </form>

      {ready && (
        <form action={saveAction} className="space-y-5 border-t border-border pt-8">
          <input type="hidden" name="url" value={preview.url} />
          <input type="hidden" name="merchant_id" value={preview.merchantId ?? ''} />
          <input type="hidden" name="currency" value={preview.currency ?? 'USD'} />

          {(preview.ownedMatches?.length ?? 0) > 0 && (
            <div
              className="rounded-card border border-accent-orange/40 bg-accent-orange-tint px-4 py-3"
              role="status"
            >
              <p className="text-sm font-medium text-ink">You may already own this</p>
              <ul className="mt-2 space-y-1 text-[13px] text-ink-muted">
                {preview.ownedMatches!.map((match) => (
                  <li key={match.id}>
                    <a href={`/inventory/${match.id}`} className="text-brand hover:underline">
                      {match.name}
                      {match.variant ? ` · ${match.variant}` : ''}
                    </a>
                    {match.costCents != null && (
                      <span> · {formatMoney(match.costCents)}</span>
                    )}
                    {match.acquiredAt && <span> · {match.acquiredAt}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-ink-faint">
                Warning only — you can still save it to the queue.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="sm:w-40">
              {preview.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant CDNs
                <img
                  src={preview.imageUrl}
                  alt=""
                  className="aspect-square w-full rounded-card border border-border object-cover bg-canvas"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-card border border-dashed border-border bg-canvas text-[12px] text-ink-faint">
                  No image
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-4">
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  name="title"
                  required
                  defaultValue={preview.title ?? ''}
                  key={`title-${preview.url}`}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="price">Price</Label>
                  <Input
                    id="price"
                    name="price"
                    inputMode="decimal"
                    placeholder="12.99"
                    defaultValue={preview.price ?? ''}
                    key={`price-${preview.url}`}
                  />
                </div>
                <div>
                  <Label htmlFor="image_url">Image URL</Label>
                  <Input
                    id="image_url"
                    name="image_url"
                    type="url"
                    defaultValue={preview.imageUrl ?? ''}
                    key={`image-${preview.url}`}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  placeholder="Size, colour, why you want it…"
                />
              </div>
              <p className="text-[13px] text-ink-muted">
                {preview.merchantName
                  ? `Merchant: ${preview.merchantName}`
                  : 'Merchant unknown from this URL'}
                {preview.source && preview.source !== 'none'
                  ? ` · filled from ${preview.source === 'json_ld' ? 'page data' : 'Open Graph'}`
                  : ' · nothing useful on the page — fill in by hand'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={savePending}>
              {savePending ? 'Saving…' : 'Save to queue'}
            </Button>
            <FieldError>{saveState.error}</FieldError>
          </div>
        </form>
      )}
    </div>
  );
}
