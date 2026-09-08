'use client';

import { useTransition } from 'react';
import { X } from 'lucide-react';
import { addOrderItemTag, removeOrderItemTag } from '@/app/shopping/orders/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';

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

  return (
    <div className="mt-2 space-y-2">
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-md bg-canvas px-1.5 py-0.5 text-small text-ink-muted"
            >
              <span>{tag.name}</span>
              {/* A glyph inside the chip, not a standalone icon button: the
                  32px icon-button shape would be taller than the chip. */}
              {!readOnly && (
                <button
                  type="button"
                  className="press flex items-center rounded-sm text-ink-muted transition-colors duration-150 hover:text-danger disabled:opacity-50"
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
                  <X className="size-3" strokeWidth={2} aria-hidden />
                  <span className="sr-only">Remove {tag.name} tag</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form
          className="flex flex-wrap items-center gap-2"
          action={(formData) => {
            startTransition(async () => {
              await addOrderItemTag(formData);
            });
          }}
        >
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="orderItemId" value={orderItemId} />
          <Input
            name="tag"
            placeholder="Add tag (e.g. shoes)"
            maxLength={40}
            className="h-8 max-w-48 text-ui"
            aria-label="Add tag"
            disabled={pending}
          />
          <Button type="submit" size="sm" variant="ghost" pending={pending}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </form>
      )}
    </div>
  );
}
