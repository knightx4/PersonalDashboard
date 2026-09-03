'use client';

import { useActionState, useState } from 'react';
import {
  createSavedItem,
  previewSavedUrl,
  type ActionState,
  type PreviewState,
} from '@/app/shopping/saved/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, Textarea } from '@/components/ui/field';
import { formatMoney } from '@/lib/money';

const previewInitial: PreviewState = {};
const saveInitial: ActionState = {};

/**
 * Inline composer for /shopping/saved: paste a URL in place, preview, then confirm.
 */
export function SaveForm({ compact = false }: { compact?: boolean }) {
  const [preview, previewAction, previewPending] = useActionState(
    previewSavedUrl,
    previewInitial,
  );
  const [saveState, saveAction, savePending] = useActionState(createSavedItem, saveInitial);
  const [urlDraft, setUrlDraft] = useState('');
  const [dismissedPreview, setDismissedPreview] = useState(false);

  const ready = Boolean(preview.url && !preview.error) && !dismissedPreview;
  const urlInputValue = urlDraft || (!dismissedPreview && preview.url) || '';

  return (
    <div className={compact ? 'space-y-4' : 'space-y-8'}>
      <form
        action={(formData) => {
          setDismissedPreview(false);
          previewAction(formData);
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
      >
        <div className="min-w-0 flex-1">
          {!compact && <Label htmlFor="url">Product URL</Label>}
          <Input
            id="url"
            name="url"
            type="url"
            required
            placeholder="Paste a product URL…"
            value={urlInputValue}
            onChange={(event) => {
              setUrlDraft(event.target.value);
              setDismissedPreview(true);
            }}
            aria-label="Product URL"
            autoFocus={compact}
          />
          {!compact && (
            <p className="mt-1.5 text-ui text-ink-muted">
              We pull title, image and price from the page when we can. You can edit
              everything before saving.
            </p>
          )}
          <FieldError>{!dismissedPreview ? preview.error : undefined}</FieldError>
        </div>
        <Button
          type="submit"
          disabled={previewPending || !urlInputValue.trim()}
          className="sm:mt-0 shrink-0"
        >
          {previewPending ? 'Looking up…' : 'Look up'}
        </Button>
      </form>

      {ready && (
        <form
          action={saveAction}
          className="space-y-5 rounded-card border border-border bg-surface p-4"
        >
          <input type="hidden" name="url" value={preview.url} />
          <input type="hidden" name="merchant_id" value={preview.merchantId ?? ''} />
          <input type="hidden" name="currency" value={preview.currency ?? 'USD'} />

          {(preview.ownedMatches?.length ?? 0) > 0 && (
            <div
              className="rounded-card border border-caution/40 bg-caution-tint px-4 py-3"
              role="status"
            >
              <p className="text-body font-medium text-ink">You may already own this</p>
              <ul className="mt-2 space-y-1 text-ui text-ink-muted">
                {preview.ownedMatches!.map((match) => (
                  <li key={match.id}>
                    <a href={`/shopping/inventory/${match.id}`} className="text-accent hover:underline">
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
              <p className="mt-2 text-small text-ink-muted">
                Warning only — you can still save it to the queue.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="sm:w-36">
              {preview.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant CDNs
                <img
                  src={preview.imageUrl}
                  alt=""
                  className="aspect-square w-full rounded-card border border-border object-cover bg-canvas"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-card border border-dashed border-border bg-canvas text-small text-ink-muted">
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
              <p className="text-ui text-ink-muted">
                {preview.merchantName
                  ? `Merchant: ${preview.merchantName}`
                  : 'Merchant unknown from this URL'}
                {preview.source && preview.source !== 'none'
                  ? ` · filled from ${preview.source === 'json_ld' ? 'page data' : 'Open Graph'}`
                  : ' · nothing useful on the page — fill in by hand'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={savePending}>
              {savePending ? 'Saving…' : 'Save to queue'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDismissedPreview(true);
                setUrlDraft('');
              }}
            >
              Cancel
            </Button>
            <FieldError>{saveState.error}</FieldError>
          </div>
        </form>
      )}
    </div>
  );
}
