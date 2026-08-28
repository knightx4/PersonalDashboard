'use client';

import { useTransition } from 'react';
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
              className="inline-flex items-center gap-1 rounded-md bg-canvas px-1.5 py-0.5 text-[12px] text-ink-muted"
            >
              <span>{tag.name}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="text-ink-faint hover:text-red-600"
                  aria-label={`Remove ${tag.name} tag`}
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
                  ×
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
            className="h-8 max-w-[12rem] text-[13px]"
            aria-label="Add tag"
            disabled={pending}
          />
          <Button type="submit" size="sm" variant="ghost" disabled={pending}>
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
