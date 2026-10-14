'use client';

import { Plus } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useCaptureAim } from '@/components/shell/capture-aim';
import type { CaptureAim } from '@/lib/capture/actions';

/**
 * A list's Add button drawn as a button rather than a quiet line (plan
 * #1950.4): the header action on a page whose main offer is adding, such as
 * Add a role on the pipeline. It opens capture aimed at the kind, the same as
 * `AddTrigger`; outside the shell (the gallery) the press does nothing.
 */
export function AimButton({
  aim,
  label,
  variant = 'primary',
  size = 'sm',
  className,
}: {
  aim: CaptureAim;
  label: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
}) {
  const openAimed = useCaptureAim();

  return (
    <Button type="button" variant={variant} size={size} className={className} onClick={() => openAimed?.(aim)}>
      <Plus className="size-4" strokeWidth={1.75} aria-hidden />
      {label}
    </Button>
  );
}
