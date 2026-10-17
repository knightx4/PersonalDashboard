'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';

/**
 * The size of the essay editor's text (note 210d50b9), as a multiple of the
 * spec's 19px. Kept per device, since a laptop and a phone want different
 * sizes.
 */
export const TEXT_SCALES = [0.85, 1, 1.15, 1.3, 1.5] as const;
const KEY = 'learn.essay.textScale';

function storedScale(): number {
  try {
    const stored = Number(window.localStorage.getItem(KEY));
    return (TEXT_SCALES as readonly number[]).includes(stored) ? stored : 1;
  } catch {
    return 1;
  }
}

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** The chosen size, read from storage through useSyncExternalStore so the server renders 1. */
export function useTextScale(): [number, (step: -1 | 1) => void] {
  const scale = useSyncExternalStore(subscribe, storedScale, () => 1);
  const step = useCallback(
    (by: -1 | 1) => {
      const at = Math.max(0, TEXT_SCALES.indexOf(scale as (typeof TEXT_SCALES)[number]));
      const next = TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, at + by))];
      try {
        window.localStorage.setItem(KEY, String(next));
      } catch {
        // Storage blocked: the size cannot be kept, so it stays as it is.
      }
      for (const listener of listeners) listener();
    },
    [scale],
  );
  return [scale, step];
}

/** Smaller and larger text, beside the editor's other tools. */
export function TextSizeControl({ scale, onStep }: { scale: number; onStep: (step: -1 | 1) => void }) {
  return (
    <div role="group" aria-label="Text size" className="flex items-center">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Smaller text"
        disabled={scale <= TEXT_SCALES[0]}
        onClick={() => onStep(-1)}
      >
        <span aria-hidden className="text-small">A</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Larger text"
        disabled={scale >= TEXT_SCALES[TEXT_SCALES.length - 1]}
        onClick={() => onStep(1)}
      >
        <span aria-hidden className="text-body">A</span>
      </Button>
    </div>
  );
}
