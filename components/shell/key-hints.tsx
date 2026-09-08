'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/cn';

/**
 * Hold ⌘ (or Alt) and every shortcut appears on the thing it drives.
 *
 * Not a cheat-sheet modal listing shortcuts in the abstract: the hints sit on
 * the actual controls, so you learn the keyboard by looking at the thing you
 * were already about to click, and they vanish when you let go. One attribute
 * on <body> does all the showing; `Kbd` below is the only thing that reads it.
 *
 * Alt as well as Meta, because the section shortcuts are ⌥1–9 and someone
 * reaching for them should see them, and because on Windows Alt is the key
 * that has one.
 */
export function KeyHintsProvider() {
  useEffect(() => {
    const body = document.body;
    function show(event: KeyboardEvent) {
      if (event.key === 'Meta' || event.key === 'Alt' || event.key === 'Control') {
        body.setAttribute('data-keyhints', '');
      }
    }
    function hide(event: KeyboardEvent) {
      if (event.key === 'Meta' || event.key === 'Alt' || event.key === 'Control') {
        body.removeAttribute('data-keyhints');
      }
    }
    // Switching tabs or windows with the key held would otherwise leave the
    // hints stuck on.
    function reset() {
      body.removeAttribute('data-keyhints');
    }
    document.addEventListener('keydown', show);
    document.addEventListener('keyup', hide);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      document.removeEventListener('keydown', show);
      document.removeEventListener('keyup', hide);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, []);
  return null;
}

/**
 * A shortcut, shown only while a modifier is held. Hidden from the
 * accessibility tree: the control it sits on already has a name, and the
 * shortcut is announced nowhere else either, which is the honest state of it.
 */
/**
 * `text-micro`, which is the bottom of the scale, and not the 10px this was
 * written at. A tenth size in a mono face is a size nobody chose -- it was one
 * step below the floor because a keycap felt like it wanted to be small -- and
 * the cap is 18px tall with `leading-none`, so the extra pixel changes nothing
 * about the box and only makes ⌥ and ⌘ legible at the size they are actually
 * read at.
 */
export function Kbd({
  children,
  className,
  always = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Show regardless of the modifier -- inside a menu that is already open. */
  always?: boolean;
}) {
  return (
    <kbd
      aria-hidden
      className={cn(
        !always && 'keyhint',
        'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded border border-border-strong border-b-2 px-1 font-mono text-micro leading-none text-ink-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
