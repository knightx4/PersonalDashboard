'use client';

import { ListPlus, RotateCcw, Trash2 } from 'lucide-react';
import {
  deleteInventoryItem,
  quickDisposeInventoryItem,
  toggleInventoryItemList,
} from '@/app/shopping/inventory/actions';
import { toggleReturnPlannedForm } from '@/app/shopping/returns/actions';
import { ActionMenu, IconActionButton, type ActionMenuItem } from '@/components/ui/action-menu';
import { DISPOSAL_METHODS } from '@/lib/inventory/status-actions';

export type InventoryListOption = {
  id: string;
  name: string;
};

function disposalLabel(method: string): string {
  return method.charAt(0).toUpperCase() + method.slice(1);
}

export function InventoryRowActions({
  itemId,
  itemName,
  returnPlanned,
  listIds,
  lists,
}: {
  itemId: string;
  itemName: string;
  returnPlanned: boolean;
  listIds: string[];
  lists: InventoryListOption[];
}) {
  const selected = new Set(listIds);
  const label = itemName.trim() || 'this item';

  const listItems: ActionMenuItem[] =
    lists.length === 0
      ? [
          {
            id: 'no-lists',
            label: 'No lists yet — create one in Settings',
            disabled: true,
          },
        ]
      : lists.map((list) => {
          const joined = selected.has(list.id);
          return {
            id: list.id,
            label: joined ? `Remove from ${list.name}` : `Add to ${list.name}`,
            formAction: toggleInventoryItemList,
            formFields: {
              id: itemId,
              list_id: list.id,
              join: joined ? 'false' : 'true',
            },
          };
        });

  const disposeItems: ActionMenuItem[] = DISPOSAL_METHODS.map((method) => ({
    id: method,
    label: disposalLabel(method),
    formAction: quickDisposeInventoryItem,
    formFields: {
      id: itemId,
      disposal_method: method,
      disposal_proceeds: '',
    },
    confirm:
      method === 'trashed'
        ? `Mark ${label} as disposed (trashed)?`
        : `Mark ${label} as ${method}?`,
  }));

  const deleteItem: ActionMenuItem = {
    id: 'delete',
    label: 'Delete item',
    destructive: true,
    formAction: deleteInventoryItem,
    formFields: { id: itemId },
    confirm: `Delete ${label} from inventory?\n\nThis cannot be undone. The order line stays in spend history.`,
  };

  const mobileMoreItems: ActionMenuItem[] = [
    ...listItems,
    {
      id: 'toggle-return',
      label: returnPlanned ? 'Unmark to return' : 'Mark for return',
      formAction: toggleReturnPlannedForm,
      formFields: {
        id: itemId,
        planned: returnPlanned ? 'false' : 'true',
      },
    },
    ...disposeItems.map((item) => ({
      ...item,
      id: `mobile-${item.id}`,
      label: `Dispose · ${item.label}`,
    })),
    deleteItem,
  ];

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {/* Desktop / tablet: dedicated quick-action icons */}
      <div className="hidden items-center gap-0.5 sm:flex">
        <ActionMenu
          label="Add to list"
          align="end"
          trigger={<ListPlus className="size-4" strokeWidth={2} aria-hidden />}
          items={listItems}
        />

        <form action={toggleReturnPlannedForm}>
          <input type="hidden" name="id" value={itemId} />
          <input type="hidden" name="planned" value={returnPlanned ? 'false' : 'true'} />
          <IconActionButton
            type="submit"
            label={returnPlanned ? 'Unmark to return' : 'Mark for return'}
            active={returnPlanned}
          >
            <RotateCcw className="size-4" strokeWidth={2} aria-hidden />
          </IconActionButton>
        </form>

        <ActionMenu
          label="Mark as disposed"
          align="end"
          trigger={<Trash2 className="size-4" strokeWidth={2} aria-hidden />}
          items={disposeItems}
        />

        <ActionMenu label="More item actions" items={[deleteItem]} />
      </div>

      {/* Phone: single overflow with the same actions */}
      <div className="sm:hidden">
        <ActionMenu label="Item actions" items={mobileMoreItems} />
      </div>
    </div>
  );
}
