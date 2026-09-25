'use client';

import { useState, type ComponentProps } from 'react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { GoalHelp } from './goal-help';
import { GoalLinksSection } from './goal-links';
import { GoalNumber } from './goal-number';

type Section = 'number' | 'help' | 'links';

/**
 * The goal's empty sections as one row of add lines above its steps (ui
 * finding 4e61bc49, plan #1038), rather than a stacked line for each. Pressing
 * one opens that section's form in place of the row; cancelling brings the row
 * back, and saving moves the section up among the ones that have something in
 * them. A section passed as null has something in it, or nothing to add, and
 * is left out.
 */
export function GoalAddRow({
  number,
  help,
  links,
}: {
  number: ComponentProps<typeof GoalNumber> | null;
  help: ComponentProps<typeof GoalHelp> | null;
  links: ComponentProps<typeof GoalLinksSection> | null;
}) {
  const [open, setOpen] = useState<Section | null>(null);
  const close = () => setOpen(null);

  // A section that stopped being empty is drawn by the page now, so the row
  // forgets it was open.
  if (open === 'number' && number) return <GoalNumber {...number} startEditing onClose={close} />;
  if (open === 'help' && help) return <GoalHelp {...help} startEditing onClose={close} />;
  if (open === 'links' && links) return <GoalLinksSection {...links} startAdding onClose={close} />;
  if (!number && !help && !links) return null;
  const aims = (links?.aimChoices?.length ?? 0) > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {number && <AddTrigger label="Track a number" onClick={() => setOpen('number')} />}
      {help && <AddTrigger label="Weekly help" onClick={() => setOpen('help')} />}
      {links && (
        <AddTrigger
          label={aims && links.jobsOn ? 'Link Learn or Jobs' : aims ? 'Link a Learn goal' : 'Link the job search'}
          onClick={() => setOpen('links')}
        />
      )}
    </div>
  );
}
