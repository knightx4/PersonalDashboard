'use client';

import { useActionState, useState } from 'react';
import {
  createSavedItem,
  previewSavedUrl,
  type ActionState,
  type PreviewState,
} from '@/app/shopping/saved/actions';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Field, FieldError, FieldHint, Input, Label, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
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
            <FieldHint>
              We pull title, image and price from the page when we can. You can edit
              everything before saving.
            </FieldHint>
          )}
          <FieldError>{!dismissedPreview ? preview.error : undefined}</FieldError>
        </div>
        <Button
          type="submit"
          pending={previewPending}
          disabled={!urlInputValue.trim()}
          className="sm:mt-0 shrink-0"
        >
          {previewPending ? 'Looking up…' : 'Look up'}
        </Button>
      </form>

      {ready && (
        <form action={saveAction} className={cn(cardVariants({ padding: 'dense' }), 'space-y-5')}>
          <input type="hidden" name="url" value={preview.url} />
          <input type="hidden" name="merchant_id" value={preview.merchantId ?? ''} />
          <input type="hidden" name="currency" value={preview.currency ?? 'USD'} />

          {(preview.ownedMatches?.length ?? 0) > 0 && (
            <Banner tone="warn">
              <p className="font-medium">You may already own this</p>
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
            </Banner>
          )}

          <div className="flex flex-col gap-5 sm:flex-row">
            <div className="sm:w-36">
              {/* Same shape as the saved item's own page: one Card holding
                  either the picture or the words. */}
              <Card padding="none" className="aspect-square overflow-hidden bg-canvas">
                {preview.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant CDNs
                  <img src={preview.imageUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-small text-ink-muted">
                    No image
                  </span>
                )}
              </Card>
            </div>

            <div className="min-w-0 flex-1 space-y-4">
              <Field id="title" label="Title">
                <Input
                  id="title"
                  name="title"
                  required
                  defaultValue={preview.title ?? ''}
                  key={`title-${preview.url}`}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="price" label="Price">
                  <Input
                    id="price"
                    name="price"
                    inputMode="decimal"
                    placeholder="12.99"
                    defaultValue={preview.price ?? ''}
                    key={`price-${preview.url}`}
                  />
                </Field>
                <Field id="image_url" label="Image URL">
                  <Input
                    id="image_url"
                    name="image_url"
                    type="url"
                    defaultValue={preview.imageUrl ?? ''}
                    key={`image-${preview.url}`}
                  />
                </Field>
              </div>
              <Field id="notes" label="Notes">
                <Textarea
                  id="notes"
                  name="notes"
                  placeholder="Size, colour, why you want it…"
                />
              </Field>
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
            <Button type="submit" pending={savePending}>
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
