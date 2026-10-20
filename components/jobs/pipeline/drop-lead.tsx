'use client';

import { useTransition } from 'react';
import { ArchiveX } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { useToast } from '@/components/ui/toast';
import { moveApplication } from '@/app/jobs/(app)/pipeline/actions';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * Drop a role you no longer mean to apply to, from its line under To apply
 * (note de9702bf). It is the status picker's Dropped (`withdrawn` before
 * anything was sent) in one press: the same override, so the role leaves the
 * section for Closed when the page revalidates, and Undo puts it back at the
 * stage it was dropped from.
 */
// latency: pending -- the line stays until the page revalidates without it
export function DropLead({
  applicationId,
  status,
  title,
}: {
  applicationId: string;
  status: ApplicationStatus;
  /** The role and company, as the toast names it. */
  title: string;
}) {
  const [pending, start] = useTransition();
  const toast = useToast();

  const drop = () =>
    start(async () => {
      const { error } = await moveApplication(applicationId, 'withdrawn');
      if (error) {
        toast({ text: `Could not drop ${title}: ${error}` });
        return;
      }
      toast({
        text: `Dropped ${title}`,
        undo: async () => {
          const back = await moveApplication(applicationId, status);
          if (back.error) throw new Error(back.error);
        },
      });
    });

  return (
    <IconButton label="Drop this role" size="sm" pending={pending} onClick={drop}>
      <ArchiveX strokeWidth={1.75} aria-hidden />
    </IconButton>
  );
}
