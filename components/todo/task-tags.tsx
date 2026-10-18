'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { usedTaskTags } from '@/app/todo/actions';
import { Button } from '@/components/ui/button';
import { chipVariants, ToggleChip } from '@/components/ui/chip';
import { FieldError, Input } from '@/components/ui/field';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { TAG_MAX, tagName, tagSuggestions } from '@/lib/todo/tasks/tags';

/**
 * A todo's tags on its row (plan #2340.2), and the picker that adds them.
 *
 * The chips sit on the title's line, after everything that says when and
 * what: they are a way of sorting the task, not part of reading it, so they
 * take the small neutral chip and no colour. A task with no tags draws
 * nothing here at all, so an untagged list reads as it did before tags.
 *
 * Removing is on the chip itself, an x that appears under the pointer or on
 * focus. A touch screen has no hover, so there the picker does both jobs:
 * every tag on the task shows in it pressed, and pressing it again takes it
 * off.
 */
export function TagChips({
  tags,
  editable,
  open,
  onToggle,
  onRemove,
  revealed = false,
  className,
}: {
  tags: readonly string[];
  /** Whether the row offers changes: an open task, not a done or dropped one. */
  editable: boolean;
  /** Whether the picker is open under the row. */
  open: boolean;
  onToggle: () => void;
  onRemove: (tag: string) => void;
  /** Draw the hover's controls at rest. For the gallery's shots. */
  revealed?: boolean;
  className?: string;
}) {
  if (tags.length === 0 && !editable) return null;

  // What waits for the pointer: drawn on hover or focus in the row, and out of
  // the layout until then, so a row at rest is laid out as it was before tags.
  // A phone has no hover, and adds a tag from the row's menu instead.
  const atRest = !open && !revealed;
  const untilPointed = 'hidden sm:group-focus-within:inline-flex sm:group-hover:inline-flex';

  // On the date's line when they fit there, wrapping chip by chip when not.
  // The 4px in front lines a pill's edge up with the text column
  // when the line starts with it, as the title and the date pad theirs.
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 pl-1',
        tags.length === 0 && atRest && untilPointed,
        className,
      )}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          title={tag}
          className={cn(
            chipVariants({ size: 'sm' }),
            'group/tag gap-0',
            'min-w-0 max-w-full shrink',
          )}
        >
          {/* A long tag is cut at 80px, about a dozen characters, so it and the
              chips after it share one line at 390 rather than taking a line
              of their own (plan #2340.2's critic). The whole name is on the
              chip's hover, and in the picker, which writes it out. */}
          <span className="min-w-0 max-w-20 truncate">{tag}</span>
          {editable && (
            <Tooltip label={`Remove ${tag}`}>
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => onRemove(tag)}
                className={cn(
                  'press inline-flex h-3.5 items-center justify-center overflow-hidden rounded-pill text-ink-muted hover:text-ink',
                  'w-0 opacity-0 focus-visible:ml-0.5 focus-visible:w-3.5 focus-visible:opacity-100',
                  '[@media(hover:hover)]:group-hover/tag:ml-0.5 [@media(hover:hover)]:group-hover/tag:w-3.5 [@media(hover:hover)]:group-hover/tag:opacity-100',
                  revealed && tag === tags[0] && 'ml-0.5 w-3.5 opacity-100',
                )}
              >
                <X strokeWidth={1.75} aria-hidden />
              </button>
            </Tooltip>
          )}
        </span>
      ))}

      {editable && (
        <Tooltip
          label={open ? 'Close the tags' : 'Add a tag'}
          // Beside tags it waits for the pointer, as the row's actions do; on
          // a phone it is out beside them.
          className={cn(
            tags.length > 0 &&
              atRest &&
              'sm:hidden sm:group-focus-within:inline-flex sm:group-hover:inline-flex',
          )}
        >
          <button
            type="button"
            aria-label={open ? 'Close the tags' : 'Add a tag'}
            aria-expanded={open}
            onClick={onToggle}
            className={cn(
              chipVariants({ size: 'sm', tone: open ? 'accent' : 'neutral' }),
              'press w-6 justify-center px-0 hover:text-ink',
            )}
          >
            <Plus strokeWidth={1.75} aria-hidden />
          </button>
        </Tooltip>
      )}
    </span>
  );
}

/**
 * Where a tag is chosen or written, under the row at the indent of its items.
 *
 * Now and Eventually lead, then every other tag the person has used, so most
 * tags are one press. Typing narrows them, and Enter puts what was typed on
 * the task as a tag of its own. Each one already on the task is pressed;
 * pressing it again takes it off.
 */
export function TagPicker({
  tags,
  used: givenUsed,
  onAdd,
  onRemove,
  onClose,
}: {
  tags: readonly string[];
  /** The tags used before. Read from the server when the picker opens unless given (the gallery gives them). */
  used?: readonly string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<readonly string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (givenUsed) return;
    let live = true;
    usedTaskTags()
      .then((names) => {
        if (live) setFetched(names);
      })
      // Without the used tags the picker still offers Now, Eventually and typing.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [givenUsed]);

  const used = givenUsed ?? fetched;
  // The ones on the task stay in the list, pressed, even when not used elsewhere.
  const offered = tagSuggestions([...used, ...tags.filter((tag) => !used.includes(tag))], typed);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = tagName.safeParse(typed);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError(null);
    setTyped('');
    if (!tags.includes(parsed.data)) onAdd(parsed.data);
  }

  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <form onSubmit={submit} className="flex items-center gap-2">
        <Input
          ref={input}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setError(null);
          }}
          maxLength={TAG_MAX}
          placeholder="New tag"
          aria-label="New tag"
          aria-invalid={error ? true : undefined}
          className="min-w-0 flex-1 max-sm:min-h-11 sm:max-w-60"
        />
        <Button type="submit" variant="secondary" size="sm">
          Add
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </form>
      <FieldError>{error}</FieldError>

      {offered.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tags">
          {offered.map((tag) => {
            const on = tags.includes(tag);
            return (
              <ToggleChip key={tag} on={on} onClick={() => (on ? onRemove(tag) : onAdd(tag))}>
                {tag}
              </ToggleChip>
            );
          })}
        </div>
      )}
    </div>
  );
}
