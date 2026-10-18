'use client';

import { useRef, useState } from 'react';
import Link from '@/components/ui/link';
import { Settings } from 'lucide-react';
import { Popover, menuItemClass } from '@/components/ui/popover';
import { Tooltip } from '@/components/ui/tooltip';
import { ThemePicker } from '@/components/shell/theme-picker';
import { usePopover } from '@/lib/use-popover';
import type { Theme } from '@/lib/theme';

/**
 * The account icon in the top bar, and the menu it opens (note 6d32355f).
 *
 * The icon used to go straight to /account, so changing the theme meant
 * leaving the page for a settings tab. The menu puts the way to the settings
 * first and the theme under it, where a click changes the room without
 * leaving the page. The picker is the one the account page shows: the same
 * controls in both places, written to the same setting.
 */
export function AccountMenu({
  initial,
  label,
  theme,
  defaultOpen = false,
}: {
  initial: string;
  label: string;
  theme: Theme;
  /** Drawn open, for the gallery's picture of the menu. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  usePopover({ open, onClose: close, panelRef, triggerRef });

  return (
    <div className="relative shrink-0">
      <Tooltip label={label} align="end" className="shrink-0">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="true"
          aria-expanded={open}
          className="press press-area flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-tint text-ui font-semibold text-accent max-lg:size-10 max-lg:text-body"
        >
          {initial}
          <span className="sr-only">Account</span>
        </button>
      </Tooltip>

      {open && (
        // data-menu-panel: the top bar sizes every button in it as an icon, and
        // the theme's controls in here are buttons that are not icons.
        <Popover ref={panelRef} padding="menu" className="sm:w-72" aria-label="Account" data-menu-panel="">
          <Link href="/account" onClick={close} className={menuItemClass()}>
            <Settings strokeWidth={1.75} className="size-4 shrink-0 text-ink-muted" aria-hidden />
            Account settings
          </Link>
          {/* The picker opens on its own labels, Light or dark first, so it
              needs no heading of its own here. */}
          <div className="mt-1 border-t border-border px-2.5 pb-2 pt-3">
            <ThemePicker value={theme} />
          </div>
        </Popover>
      )}
    </div>
  );
}
