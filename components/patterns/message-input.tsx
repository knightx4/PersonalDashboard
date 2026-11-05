'use client';

import { Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';

/**
 * The box a message is typed in, under a thread (the messaging pattern).
 *
 * A line that runs past the box's width wraps onto the next and the box grows
 * with it, up to a few lines and then scrolls, as a texting app's does (note
 * f407a1cc). It was a one-line input, which slid a long message sideways out
 * of sight. Enter sends, as it did; Shift+Enter starts a new line.
 */
export function MessageInput({ className, onKeyDown, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <Textarea
      rows={1}
      enterKeyHint="send"
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      }}
      className={cn(
        'min-h-(--control-h) max-h-40 flex-1 resize-none rounded-pill border-border bg-sunken px-3.5 leading-snug max-sm:min-h-11 max-sm:py-[0.6875rem]',
        className,
      )}
      {...props}
    />
  );
}
