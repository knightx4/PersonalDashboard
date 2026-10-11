'use client';

import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { disconnectVault, rescanVault } from './actions';

/**
 * Re-read everything and Disconnect, behind one menu beside Sync now (plan
 * #1795), so the three fit on one line at 390. Disconnect confirms inside the
 * menu before it runs, since it removes the copy of the notes.
 */
export function VaultMoreMenu({ connectionId }: { connectionId: string }) {
  const items: ActionMenuItem[] = [
    {
      id: 'rescan',
      label: 'Re-read everything',
      formAction: rescanVault,
      formFields: { id: connectionId },
    },
    {
      id: 'disconnect',
      label: 'Disconnect',
      destructive: true,
      confirm: 'Disconnect? This removes the copy of your notes here; your vault is untouched.',
      formAction: disconnectVault,
      formFields: { id: connectionId },
    },
  ];
  return <ActionMenu label="More vault actions" items={items} align="end" />;
}
