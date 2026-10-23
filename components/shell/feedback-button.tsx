'use client';

import { usePathname } from 'next/navigation';
import { MessageSquarePlus } from 'lucide-react';
import { useCaptureAim } from '@/components/shell/capture-aim';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The notes button: capture aimed at a note for Dev (plan #1950.5), from
 * every page.
 *
 * From lg up it sits in the status line, just left of the runner's four
 * Dashes (note 2f0f2a60). Below lg that line is not drawn, so it stays in the
 * header there. Either way it is on every page, so the thought can be written
 * down where it occurs, and the note records the page you were on: half of every bug report is
 * "where were you when it happened", and that half is free. Capture's panel
 * takes the words and any screenshot (plan #1713), one press saves the note
 * to the queue, and the page stays where it was.
 *
 * Every account files notes, not only the owner: a bug is a bug whoever hit
 * it. Once saved, triage sorts the note as it always has, and one the owner's
 * triage is sure needs planning moves to the ideas page (plan #1675).
 */
export function NoteButton({
  inStatusLine = false,
  className,
}: {
  /** Drawn small in the status line, its tip standing above it. */
  inStatusLine?: boolean;
  /** On the tip's wrapper, which is what the row lays out. */
  className?: string;
}) {
  const pathname = usePathname();
  const aim = useCaptureAim();

  return (
    <Tooltip
      label="Report a bug or ask for a change"
      align="end"
      above={inStatusLine}
      className={className}
    >
      <IconButton
        label="Report a bug or ask for a change"
        onClick={() => aim?.({ kind: 'dev-note', page: pathname })}
        aria-haspopup="dialog"
        size={inStatusLine ? 'sm' : 'md'}
        className="text-shell-muted hover:bg-shell-hover hover:text-shell-ink"
      >
        <MessageSquarePlus strokeWidth={1.75} aria-hidden />
      </IconButton>
    </Tooltip>
  );
}
