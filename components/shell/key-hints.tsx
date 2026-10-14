'use client';

import { useEffect } from 'react';

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

/** Moved to components/ui/kbd.tsx; re-exported for callers not yet moved. */
export { Kbd } from '@/components/ui/kbd';
