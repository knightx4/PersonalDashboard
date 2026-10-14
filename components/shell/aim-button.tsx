'use client';

import { Plus } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { useCaptureAim } from '@/components/shell/capture-aim';
import type { CaptureAim } from '@/lib/capture/actions';

/**
 * A page's Add button that opens capture aimed at its kind (plan #1950.3.1):
 * the button a header or an empty list leads with, where AddTrigger is the
 * quiet line inside a section. One press opens the panel, one more makes the
 * row and opens it.
 *
 * Outside the shell (the gallery) there is no capture to open, and the
 * button does nothing.
 */
export function AimButton({
  aim,
  label,
  variant = 'primary',
  size = 'sm',
}: {
  aim: CaptureAim;
  label: string;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md';
}) {
  const openAimed = useCaptureAim();

  return (
    <button type="button" onClick={() => openAimed?.(aim)} className={buttonVariants({ variant, size })}>
      <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}
