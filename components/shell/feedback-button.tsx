'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { MessageSquarePlus } from 'lucide-react';
import {
  submitFeedback,
  type FeedbackActionState,
} from '@/app/shopping/feedback/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';

/**
 * Always-available capture for bugs and ideas.
 *
 * It lives in the header so the thought can be written down where it occurs,
 * and it records the page you were on — half of every bug report is "where
 * were you when it happened", and that half is free.
 */
export function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'bug' | 'feature'>('feature');
  const panelRef = useRef<HTMLDivElement>(null);
  const [state, action, pending] = useActionState(
    submitFeedback,
    {} as FeedbackActionState,
  );

  // Close on Escape, and on a click outside the panel.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onClick(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    // Deferred so the click that opened the panel does not close it.
    const timer = setTimeout(() => document.addEventListener('click', onClick), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      clearTimeout(timer);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Report a bug or request a feature"
        className={cn(
          'press flex size-8 items-center justify-center rounded-full transition-colors',
          open ? 'bg-brand-tint text-brand' : 'text-ink-muted hover:bg-canvas hover:text-ink',
        )}
      >
        <MessageSquarePlus className="size-4" aria-hidden />
        <span className="sr-only">Report a bug or request a feature</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Send feedback"
          className="absolute right-0 top-10 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-4 shadow-lg"
        >
          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="page_path" value={pathname} />
            <input
              type="hidden"
              name="user_agent"
              value={typeof navigator === 'undefined' ? '' : navigator.userAgent}
            />
            <input type="hidden" name="kind" value={kind} />

            <div className="flex gap-1">
              {(['bug', 'feature'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKind(option)}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                    kind === option
                      ? 'bg-brand-tint text-brand'
                      : 'text-ink-muted hover:bg-canvas hover:text-ink',
                  )}
                >
                  {option === 'bug' ? 'Bug' : 'Feature'}
                </button>
              ))}
            </div>

            <div>
              <Label htmlFor="feedback_body">
                {kind === 'bug' ? 'What went wrong?' : 'What should it do?'}
              </Label>
              <Textarea
                id="feedback_body"
                name="body"
                rows={4}
                required
                placeholder={
                  kind === 'bug'
                    ? 'What you did, what happened, what you expected.'
                    : 'The change, and what it would let you do.'
                }
              />
              <p className="mt-1 text-[12px] text-ink-faint">
                Saved with the page you are on ({pathname}).
              </p>
            </div>

            <div>
              <Label htmlFor="feedback_code">Code</Label>
              <Input
                id="feedback_code"
                name="code"
                type="password"
                autoComplete="off"
                required
                placeholder="Submit code"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? 'Saving…' : 'Send'}
              </Button>
              <Link
                href="/shopping/feedback"
                className="text-[13px] text-brand hover:underline"
                onClick={() => setOpen(false)}
              >
                See all
              </Link>
            </div>

            <FieldError>{state.error}</FieldError>
            {state.message && (
              <p className="text-[13px] text-brand">{state.message}</p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
