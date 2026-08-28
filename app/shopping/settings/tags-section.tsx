'use client';

import { deleteItemTag } from '@/app/shopping/settings/actions';
import { Button } from '@/components/ui/button';

export type SettingsTag = {
  id: string;
  name: string;
  slug: string;
};

export function TagsSection({ tags }: { tags: SettingsTag[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Tags are specific labels on order lines — shoes, sneakers, makeup — while categories stay
        high-level (clothing, beauty). They are suggested on import and used to filter and search
        orders.
      </p>
      {tags.length === 0 ? (
        <p className="text-sm text-ink-faint">
          None yet — tags appear automatically when orders are imported, or add one on an order.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
            >
              <span className="font-medium text-ink">{tag.name}</span>
              <form action={deleteItemTag}>
                <input type="hidden" name="id" value={tag.id} />
                <Button type="submit" size="sm" variant="ghost">
                  Delete
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TagsSectionTitle() {
  return <>Tags</>;
}
