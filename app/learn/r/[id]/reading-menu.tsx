'use client';

import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { removeFromTrack } from '../../t/[id]/actions';

/**
 * The reading's own actions, on the title's line (plan #1876.4): the source
 * itself, unnarrowed, and taking the reading off its list. Removal is for
 * rows that should never have been here; giving up is a status instead.
 */
export function ReadingMenu({
  readingId,
  trackId,
  sourceUrl,
}: {
  readingId: string;
  trackId: string;
  sourceUrl: string | null;
}) {
  const items: ActionMenuItem[] = [
    ...(sourceUrl ? [{ id: 'source', label: 'Open the source itself, unnarrowed', href: sourceUrl }] : []),
    {
      id: 'remove',
      label: 'Remove from this reading list',
      confirm: 'Remove it for good? To keep it but stop working on it, mark it as gave up instead.',
      destructive: true,
      formAction: removeFromTrack,
      formFields: { readingId, trackId },
    },
  ];
  return <ActionMenu label="More reading actions" items={items} triggerClassName="size-8 border border-border" />;
}
