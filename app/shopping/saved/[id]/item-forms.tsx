'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  deleteSavedItem,
  dismissSavedItem,
  markSavedPurchased,
  restoreSavedItem,
  updateSavedItem,
  type ActionState,
} from '@/app/shopping/saved/actions';
import { DetailFacts, DetailPage } from '@/components/patterns/list-detail';
import { Property } from '@/components/shell/detail-layout';
import { PageHeader } from '@/components/shell/page-header';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { linkVariants } from '@/components/ui/link';
import { SectionHeading, SectionLabel } from '@/components/ui/section-heading';
import { cn } from '@/lib/cn';
import { EditableProse } from '@/components/ui/editable-prose';
import { FieldError, InlineInput, InlineTextarea } from '@/components/ui/field';
import { formatCentsAsDollarsInput } from '@/lib/money';

export type EditableSavedItem = {
  id: string;
  url: string;
  title: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  currency: string;
  notes: string | null;
  merchantId: string | null;
  status: 'saved' | 'purchased' | 'dismissed';
};

const initial: ActionState = {};

function PurchasedButton({ itemId }: { itemId: string }) {
  const [state, formAction, pending] = useActionState(markSavedPurchased, initial);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={itemId} />
      <Button type="submit" size="sm" variant="primary" pending={pending}>
        {pending ? 'Updating…' : 'Mark purchased'}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

type Fields = {
  title: string;
  price: string;
  url: string;
  imageUrl: string;
  notes: string;
};

/** An inline field's own padding pulled back, so its text starts where its label does. */
const flush = '-mx-1 max-sm:-my-2 max-sm:py-2.5';

/** A fact that runs the whole row at every width: an address does not fit a quarter of one. */
function WideFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="col-span-2 min-w-0 sm:col-span-4">
      <SectionLabel as="dt">{label}</SectionLabel>
      <dd className="mt-0.5 text-ui text-ink">{value}</dd>
    </div>
  );
}

/**
 * One saved item's page, edited where it is read (plan #1787): the title, the
 * price, the URL and the notes are the text itself, saved when you leave the
 * field. The header carries the move that matters, Mark purchased, beside Open
 * product; Dismiss and Delete sit behind the menu.
 */
export function SavedItemBody({
  item,
  subtitle,
  banner,
}: {
  item: EditableSavedItem;
  subtitle: string;
  banner?: React.ReactNode;
}) {
  // The last values the server accepted, to tell a change from a visit.
  const [lastSaved, setLastSaved] = useState<Fields>({
    title: item.title ?? '',
    price: item.priceCents != null ? formatCentsAsDollarsInput(item.priceCents) : '',
    url: item.url,
    imageUrl: item.imageUrl ?? '',
    notes: item.notes ?? '',
  });
  const [title, setTitle] = useState(lastSaved.title);
  const [price, setPrice] = useState(lastSaved.price);
  const [url, setUrl] = useState(lastSaved.url);
  const [imageUrl, setImageUrl] = useState(lastSaved.imageUrl);
  const [editingUrl, setEditingUrl] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  async function commit(patch: Partial<Fields>): Promise<string | null> {
    const next = { ...lastSaved, ...patch };
    const form = new FormData();
    form.set('id', item.id);
    form.set('merchant_id', item.merchantId ?? '');
    form.set('currency', item.currency);
    form.set('title', next.title);
    form.set('price', next.price);
    form.set('url', next.url);
    form.set('image_url', next.imageUrl);
    form.set('notes', next.notes);
    const result = await updateSavedItem(initial, form);
    if (result.error) {
      setError(result.error);
      return result.error;
    }
    setError(null);
    setLastSaved(next);
    return null;
  }

  function leave(field: Exclude<keyof Fields, 'notes'>, value: string) {
    const next = value.trim();
    if (next === lastSaved[field]) return;
    start(async () => {
      const failed = await commit({ [field]: next });
      if (!failed) return;
      // Put back what the server still holds; the reason stays under the header.
      if (field === 'title') setTitle(lastSaved.title);
      if (field === 'price') setPrice(lastSaved.price);
      if (field === 'url') setUrl(lastSaved.url);
      if (field === 'imageUrl') setImageUrl(lastSaved.imageUrl);
    });
  }

  const enterLeaves = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  const menu: ActionMenuItem[] = [];
  if (item.status !== 'dismissed') {
    menu.push({
      id: 'dismiss',
      label: 'Dismiss',
      formAction: (formData) => dismissSavedItem(initial, formData),
      formFields: { id: item.id },
    });
  }
  if (item.status !== 'saved') {
    menu.push({
      id: 'restore',
      label: 'Move back to saved',
      formAction: (formData) => restoreSavedItem(initial, formData),
      formFields: { id: item.id },
    });
  }
  menu.push({
    id: 'delete',
    label: 'Delete',
    destructive: true,
    confirm: 'Delete this saved item?',
    formAction: (formData) => deleteSavedItem(initial, formData),
    formFields: { id: item.id },
  });

  return (
    <DetailPage
      className="[&_a]:press-area"
      header={
        <>
          <PageHeader
            leading={
              lastSaved.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary merchant CDNs
                <img
                  src={lastSaved.imageUrl}
                  alt=""
                  className="size-12 rounded-control bg-canvas object-cover"
                />
              ) : undefined
            }
            title={
              <InlineTextarea
                aria-label="Title"
                value={title}
                placeholder="Untitled"
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => leave('title', title)}
                className="-ml-1 font-semibold"
              />
            }
            description={subtitle}
          />
          <div className="-mt-2 mb-5 flex flex-wrap items-center gap-2">
            {item.status !== 'purchased' && <PurchasedButton itemId={item.id} />}
            <a
              href={lastSaved.url}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              Open product
            </a>
            <ActionMenu label="More actions for this item" items={menu} />
          </div>
          <FieldError>{error}</FieldError>
        </>
      }
      details={
        <DetailFacts>
          <Property
            label={`Price (${item.currency})`}
            value={
              <InlineInput
                aria-label="Price"
                inputMode="decimal"
                placeholder="Add price"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                onBlur={() => leave('price', price)}
                onKeyDown={enterLeaves}
                className={cn(flush, 'tabular')}
              />
            }
          />
          <Property label="Status" value={<span className="capitalize">{item.status}</span>} />
          <WideFact
            label="URL"
            value={
              editingUrl ? (
                <InlineInput
                  aria-label="URL"
                  type="url"
                  autoFocus
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onBlur={() => {
                    leave('url', url);
                    setEditingUrl(false);
                  }}
                  onKeyDown={enterLeaves}
                  className={flush}
                />
              ) : (
                <span className="flex items-baseline gap-3">
                  <a
                    href={lastSaved.url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn('min-w-0 flex-1 truncate', linkVariants())}
                  >
                    {lastSaved.url}
                  </a>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setEditingUrl(true)}
                    className="-mx-1 shrink-0"
                  >
                    Edit
                  </Button>
                </span>
              )
            }
          />
          <WideFact
            label="Image"
            value={
              editingImage ? (
                <InlineInput
                  aria-label="Image URL"
                  type="url"
                  autoFocus
                  placeholder="Paste an image address"
                  value={imageUrl}
                  onChange={(event) => setImageUrl(event.target.value)}
                  onBlur={() => {
                    leave('imageUrl', imageUrl);
                    setEditingImage(false);
                  }}
                  onKeyDown={enterLeaves}
                  className={flush}
                />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditingImage(true)}
                  className="-mx-1"
                >
                  {lastSaved.imageUrl ? 'Change image' : 'Add image'}
                </Button>
              )
            }
          />
        </DetailFacts>
      }
      text={
        <section aria-label="Notes" className="space-y-2">
          <SectionHeading title="Notes" />
          <Card padding="dense">
            <EditableProse
              label="Notes"
              value={lastSaved.notes}
              empty="Add a note"
              editLabel="Edit notes"
              onSave={(next) => commit({ notes: next })}
            />
          </Card>
        </section>
      }
    >
      {banner}
    </DetailPage>
  );
}
