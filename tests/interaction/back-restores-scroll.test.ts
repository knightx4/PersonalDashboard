/**
 * Back restores the pane's scroll position and a link starts at the top
 * (plan #1919.2). The offsets live in lib/shell/pane-scroll.ts; the shell
 * reads them on a path change (components/shell/app-shell.tsx).
 */
import { expect, it } from 'vitest';
import { openingOffset, readPaneScroll, savePaneScroll } from '@/lib/shell/pane-scroll';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

it('restores the saved offset on a pop', () => {
  const store = memory();
  savePaneScroll('/jobs/roles', 840.4, store);
  expect(openingOffset('/jobs/roles', true, store)).toBe(840);
});

it('starts at the top on a push, whatever was saved', () => {
  const store = memory();
  savePaneScroll('/jobs/roles', 840, store);
  expect(openingOffset('/jobs/roles', false, store)).toBe(0);
});

it('keeps each path apart and treats an unseen one as the top', () => {
  const store = memory();
  savePaneScroll('/a', 100, store);
  savePaneScroll('/b', 200, store);
  expect(readPaneScroll('/a', store)).toBe(100);
  expect(readPaneScroll('/b', store)).toBe(200);
  expect(openingOffset('/c', true, store)).toBe(0);
});

it('survives storage that throws', () => {
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  expect(() => savePaneScroll('/a', 5, broken)).not.toThrow();
  expect(openingOffset('/a', true, broken)).toBe(0);
});
