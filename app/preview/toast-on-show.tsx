'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/ui/toast';

/**
 * Puts one toast with an Undo up as the gallery draws the surface, held
 * long enough to photograph, so a "did it, here is the way back" moment can
 * be drawn without pressing anything.
 */
export function ToastOnShow({ text }: { text: string }) {
  const toast = useToast();
  useEffect(() => {
    toast({ text, undo: () => undefined, duration: 600_000 });
  }, [toast, text]);
  return null;
}
