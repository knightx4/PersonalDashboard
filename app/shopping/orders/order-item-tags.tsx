'use client';

import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { addOrderItemTag, removeOrderItemTag } from '@/app/shopping/orders/actions';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/field';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * An item's tags as chips on one line, ending in a quiet "Add tag" that
 * becomes the field when pressed (plan #1782). The field is not on screen
 * until somebody wants to type in it (law 14).
 */
export function OrderItemTags({
  orderId,
  orderItemId,
  tags,
  readOnly = false,
}: {
  orderId: string;
  orderItemId: string;
  tags: Array<{ id: string; name: string }>;
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  if (readOnly && tags.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <Chip key={tag.id}>
          <span>{tag.name}</span>
          {/* A glyph inside the chip, not a standalone icon button: the
              32px icon-button shape would be taller than the chip. */}
          {!readOnly && (
            <Tooltip label={`Remove the ${tag.name} tag`}>
              <button
                type="button"
                className="press flex items-center rounded-control text-ink-muted transition-colors duration-quick hover:text-danger disabled:opacity-50"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await removeOrderItemTag({
                      orderId,
                      orderItemId,
                      tagId: tag.id,
                    });
                  })
                }
              >
                <X strokeWidth={1.75} aria-hidden />
                <span className="sr-only">Remove {tag.name} tag</span>
              </button>
            </Tooltip>
          )}
        </Chip>
      ))}
      {!readOnly && !adding && (
        <AddTrigger label="Add tag" onClick={() => setAdding(true)} className="ml-0 py-0.5" />
      )}
      {!readOnly && adding && (
        <form
          className="flex basis-full flex-wrap items-center gap-2"
          action={(formData) => {
            startTransition(async () => {
              await addOrderItemTag(formData);
              setAdding(false);
            });
          }}
        >
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="orderItemId" value={orderItemId} />
          {/* Width only: Input keeps its own height and its 16px text, which
              stops iOS zooming the page when the field is tapped. */}
          <Input
            name="tag"
            placeholder="shoes"
            maxLength={40}
            className="max-w-48"
            aria-label="Add tag"
            autoFocus
            disabled={pending}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setAdding(false);
            }}
          />
          <Button type="submit" size="sm" variant="secondary" pending={pending}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setAdding(false)}
          >
            Cancel
          </Button>
        </form>
      )}
    </div>
  );
}
