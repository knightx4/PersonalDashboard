'use client';

import Link, { linkVariants } from '@/components/ui/link';
import { useState, useTransition } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { FieldError, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { addQuickNote } from '@/app/vault/actions';
import { TriageEntry } from './triage-entry';

/**
 * The Quick note triage row with its Add a quick note button beside it (plan
 * #1730, feature #1726). The button opens a text box; saving files the text in
 * the vault's Inbox folder, where Quick note triage picks it up, and the
 * waiting count beside it goes up.
 *
 * New note (the header's button) is for a note with a name that opens when it
 * is made. This is the other thing: a thought set down without choosing
 * anything, to be sorted afterwards.
 *
 * With a vault token that cannot write, the button stays and says why instead
 * of opening a box that would fail on save.
 */
export function QuickNoteRow({
  waiting,
  writable,
  startOpen = false,
  startText = '',
}: {
  waiting: number;
  writable: boolean;
  /** The gallery draws the box open; the page starts shut. */
  startOpen?: boolean;
  /** What the gallery draws already typed. */
  startText?: string;
}) {
  const [open, setOpen] = useState(startOpen);
  const [text, setText] = useState(startText);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const result = await addQuickNote(text);
      if (result.error) {
        setError(result.error);
        return;
      }
      setText('');
      setOpen(false);
      setSaved(true);
    });
  }

  return (
    <div className="mb-5 space-y-3">
      {/* One surface: the triage row, and the press that adds to it. */}
      <div
        className={cn(
          cardVariants(),
          'flex flex-col divide-y divide-border overflow-hidden sm:flex-row sm:divide-x sm:divide-y-0',
        )}
      >
        <TriageEntry waiting={waiting} bare />
        {(!open || !writable) && (
          <Button
            type="button"
            variant="ghost"
            className="h-11 rounded-none px-4 text-ink sm:h-auto" /* ui-ok: 44px press target on a phone */
            aria-expanded={open}
            onClick={() => {
              setSaved(false);
              setOpen((was) => !was);
            }}
          >
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
            Add a quick note
          </Button>
        )}
      </div>

      {saved && !open && (
        <p role="status" className="text-ui text-ink-muted">
          Added to Quick note triage.
        </p>
      )}

      {open &&
        (writable ? (
          <form
            className={cn(cardVariants(), 'space-y-3 p-4')}
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Whatever is on your mind"
              aria-label="Quick note"
              autoFocus
              className="min-h-24"
            />
            <FieldError>{error}</FieldError>
            <p className="text-small text-ink-muted">Goes into your Inbox folder, to sort later.</p>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" pending={pending} disabled={!text.trim()}>
                {pending ? 'Adding…' : 'Add quick note'}
              </Button>
            </div>
          </form>
        ) : (
          <p className={cn(cardVariants(), 'p-4 text-ui text-ink-muted')}>
            Your vault token can read notes but not write them, so a quick note cannot be added from
            here.{' '}
            <Link href="/vault/settings" className={`whitespace-nowrap ${linkVariants()}`}>
              Vault settings
            </Link>
          </p>
        ))}
    </div>
  );
}
