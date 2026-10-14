'use client';

import { usePathname } from 'next/navigation';
import { MessageSquarePlus } from 'lucide-react';
import { useCaptureAim } from '@/components/shell/capture-aim';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The notes button in the header: capture aimed at a note for Dev (plan
 * #1950.5), from every page.
 *
 * It lives in the header so the thought can be written down where it occurs,
 * and the note records the page you were on: half of every bug report is
 * "where were you when it happened", and that half is free. Capture's panel
 * takes the words and any screenshot (plan #1713), one press saves the note
 * to the queue, and the page stays where it was.
 *
 * Every account files notes, not only the owner: a bug is a bug whoever hit
 * it. Once saved, triage sorts the note as it always has, and one the owner's
 * triage is sure needs planning moves to the ideas page (plan #1675).
 */
export function NoteButton() {
  const pathname = usePathname();
  const aim = useCaptureAim();

  return (
    <Tooltip label="Report a bug or ask for a change" align="end">
      <IconButton
        label="Report a bug or ask for a change"
        onClick={() => aim?.({ kind: 'dev-note', page: pathname })}
        aria-haspopup="dialog"
        className="text-shell-muted hover:bg-shell-hover hover:text-shell-ink"
      >
        <MessageSquarePlus strokeWidth={1.75} aria-hidden />
      </IconButton>
    </Tooltip>
  );
}
