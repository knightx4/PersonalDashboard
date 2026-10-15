'use client';

import { cardVariants } from '@/components/ui/card';
import { menuItemClass, popoverSurface } from '@/components/ui/popover';
import { LATER_CHOICES, LaterDayField, LaterMenu } from '@/components/inbox/snooze-menu';
import { cn } from '@/lib/cn';
import { PICK_A_DAY } from '@/lib/core/snooze-days';

const TITLE = 'Book the boiler service before the first cold week of the winter';

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
      <p className="min-w-0 flex-1 text-body break-words text-ink">{label}</p>
      {children}
    </div>
  );
}

/**
 * Later, the one menu for putting a thing off (plan #1957.2): its word
 * trigger (a goal step, a raise, an Inbox row), its clock alone (a todo's
 * row of icons), the menu open with its five days, and Pick a day's field.
 * The open menu is drawn from the same entries and classes ActionMenu uses,
 * since a portalled menu cannot be photographed open from a press.
 */
export function LaterMenuRows() {
  return (
    <div className="space-y-4">
      <div className={cn(cardVariants(), 'divide-y divide-border')}>
        <Line label={TITLE}>
          <LaterMenu label={TITLE} onChoose={() => {}} />
        </Line>
        <Line label="Renew the passport">
          <LaterMenu compact label="Renew the passport" onChoose={() => {}} />
        </Line>
      </div>
      <div className="flex justify-end">
        <div role="menu" aria-label={`Later: ${TITLE}`} className={cn(popoverSurface, 'w-48 overflow-hidden p-1')}>
          {LATER_CHOICES.map((item) => (
            <button key={item.id} type="button" role="menuitem" className={menuItemClass(false)}>
              {item.label}
            </button>
          ))}
          <button type="button" role="menuitem" className={menuItemClass(false)}>
            {PICK_A_DAY}
          </button>
        </div>
      </div>
      <div className={cardVariants({ padding: 'standard' })}>
        <LaterDayField label={TITLE} onChoose={() => {}} onCancel={() => {}} />
      </div>
    </div>
  );
}
