'use client';

import { Button, type ButtonProps } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { Tooltip } from '@/components/ui/tooltip';
import { LIFECYCLE_GLYPH, LIFECYCLE_VERB, type Lifecycle } from '@/lib/core/lifecycle';

/**
 * The button that closes a row, one of four (docs/ONE-INTERFACE-SPEC.md,
 * Part 4; plan #1957.3): Done, Drop, Later or Decline, each with its glyph
 * from lib/core/lifecycle.ts. Decline only on what the app or Dash proposed;
 * the person's own row is dropped. The word is always the verb, so a caller
 * cannot write "Dismiss" or "Not now" by passing children.
 *
 * It only draws the press. The write, and the toast with its Undo, are the
 * caller's (components/ui/toast.tsx), since each row knows how to put itself
 * back. Later with a day to choose is LaterMenu (./snooze-menu.tsx).
 */
export function CloseButton({
  lifecycle,
  compact = false,
  label,
  variant = 'ghost',
  size = 'sm',
  ...props
}: Omit<ButtonProps, 'children'> & {
  lifecycle: Lifecycle;
  /** The glyph alone, for a row of icon controls; the word beside it otherwise. */
  compact?: boolean;
  /** What the row is, for the accessible name of the compact form. */
  label?: string;
}) {
  const verb = LIFECYCLE_VERB[lifecycle];
  if (compact) {
    const name = label ? `${verb}: ${label}` : verb;
    return (
      <Tooltip label={verb} align="end" className="flex">
        <IconButton
          label={name}
          size="sm"
          onClick={props.onClick}
          disabled={props.disabled}
          pending={props.pending}
          className={props.className}
        >
          <StatusGlyph glyph={LIFECYCLE_GLYPH[lifecycle]} />
        </IconButton>
      </Tooltip>
    );
  }
  return (
    <Button type="button" variant={variant} size={size} {...props}>
      <StatusGlyph glyph={LIFECYCLE_GLYPH[lifecycle]} />
      {verb}
    </Button>
  );
}
