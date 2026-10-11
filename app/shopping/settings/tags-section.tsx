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
      {/* The sentence is the empty state: rows say what the card is once
          there are any (plan #1788, law 15). */}
      {tags.length === 0 ? (
        <p className="text-body text-ink-muted">
          No tags yet. Tags are specific labels on order lines, such as shoes or makeup, where
          categories stay broad. They appear when orders are imported, or add one on an order.
        </p>
      ) : (
        // Divides and space, no frame: the settings card around this
        // already said these belong together. Law 11.
        <ul className="divide-y divide-border">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="row-pad flex items-center justify-between gap-3 text-body"
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
