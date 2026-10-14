'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { Input, Select, Switch } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';

/**
 * The fields of a settings page (components/patterns/settings-page.tsx),
 * which save themselves: the save model on /dev/ui says settings-shaped
 * things autosave on blur with a quiet "Saved" in the toast, and never mix
 * that with a Save button in one panel.
 *
 * A text or number field saves when it loses focus, and only when its value
 * changed. A switch and a choice save on the press, since the press is the
 * whole of the edit and there is nothing to finish typing. Each takes a
 * server action, `save`, that answers `{ error }` when it refuses; the field
 * puts the old value back and the toast says why.
 */
export type SaveSetting<T> = (value: T) => Promise<{ error?: string } | void>;

/** Saves one value and says so in the toast. */
export function useSettingSave<T>(save: SaveSetting<T>) {
  const toast = useToast();
  const [pending, start] = useTransition();
  function run(value: T, revert: () => void) {
    start(async () => {
      let error: string | undefined;
      try {
        error = (await save(value))?.error;
      } catch {
        error = 'Dash could not save that. Try again.';
      }
      if (error) {
        revert();
        toast({ text: error });
      } else {
        toast({ text: 'Saved', duration: 2000 });
      }
    });
  }
  return { run, pending };
}

/** A setting's row: its name and one line on what it does, with the control opposite. */
function Row({
  title,
  hint,
  htmlFor,
  children,
  stacked,
}: {
  title: string;
  hint?: React.ReactNode;
  htmlFor: string;
  children: React.ReactNode;
  /** The control under the words rather than beside them, for a wide field. */
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex gap-x-4 gap-y-2 py-2',
        stacked ? 'flex-col' : 'items-start justify-between max-sm:min-h-11',
      )}
    >
      <label htmlFor={htmlFor} className="min-w-0 cursor-pointer">
        <span className="block text-ui text-ink">{title}</span>
        {hint && <span className="mt-0.5 block text-small text-ink-muted">{hint}</span>}
      </label>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** On or off, saved on the press. */
export function SettingSwitch({
  title,
  hint,
  defaultChecked,
  save,
}: {
  title: string;
  hint?: React.ReactNode;
  defaultChecked: boolean;
  save: SaveSetting<boolean>;
}) {
  const id = useId();
  const [on, setOn] = useState(defaultChecked);
  const { run, pending } = useSettingSave(save);
  return (
    <Row title={title} hint={hint} htmlFor={id}>
      <Switch
        id={id}
        checked={on}
        disabled={pending}
        className="mt-0.5"
        onChange={(event) => {
          const next = event.target.checked;
          setOn(next);
          run(next, () => setOn(!next));
        }}
      />
    </Row>
  );
}

/** One of a few choices, saved on the press. */
export function SettingSelect({
  title,
  hint,
  options,
  defaultValue,
  save,
}: {
  title: string;
  hint?: React.ReactNode;
  options: readonly { value: string; label: string }[];
  defaultValue: string;
  save: SaveSetting<string>;
}) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const { run, pending } = useSettingSave(save);
  return (
    <Row title={title} hint={hint} htmlFor={id}>
      <Select
        id={id}
        value={value}
        disabled={pending}
        onChange={(event) => {
          const previous = value;
          const next = event.target.value;
          setValue(next);
          run(next, () => setValue(previous));
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Row>
  );
}

/**
 * Text, a number or a day, read first (law 14): the value is shown as text,
 * pressing it opens it for editing in place, and leaving the field saves it
 * when it changed. Enter saves and Escape puts it back. `format` words the
 * value for reading, such as "21 days" for 21; it runs in the browser, so
 * only a client component can pass one.
 */
export function SettingText({
  title,
  hint,
  defaultValue,
  save,
  type = 'text',
  placeholder,
  inputMode,
  format,
  titleHidden,
}: {
  title: string;
  hint?: React.ReactNode;
  defaultValue: string;
  save: SaveSetting<string>;
  type?: 'text' | 'number' | 'url' | 'email' | 'date';
  /** Shown in the field while it is empty, and in place of an empty value. */
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  format?: (value: string) => string;
  /** Leave the title to a screen reader, when the section heading already names the value. */
  titleHidden?: boolean;
}) {
  const id = useId();
  const saved = useRef(defaultValue);
  const [value, setValue] = useState(defaultValue);
  const [editing, setEditing] = useState(false);
  const { run } = useSettingSave(save);

  /** The value as text, or its editor while it is open. */
  function control(look: string) {
    if (editing) {
      return (
        <Input
          id={id}
          autoFocus
          type={type}
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          className={type === 'text' || type === 'url' || type === 'email' ? undefined : 'w-44'}
          onChange={(event) => setValue(event.target.value)}
          onBlur={leave}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setValue(saved.current);
              setEditing(false);
            }
          }}
        />
      );
    }
    const shown = value ? (format ? format(value) : value) : (placeholder ?? 'Not set');
    return (
      <button
        id={id}
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`${title}: ${value ? shown : 'not set'}. Change`}
        className={cn(
          'press -mx-1 rounded-control px-1 text-left hover:bg-sunken',
          look,
          value ? 'text-ink' : 'text-ink-ghost',
        )}
      >
        {shown}
      </button>
    );
  }

  function leave() {
    setEditing(false);
    const next = value.trim();
    if (next === saved.current) return;
    const previous = saved.current;
    saved.current = next;
    run(next, () => {
      saved.current = previous;
      setValue(previous);
    });
  }

  return (
    titleHidden ? (
      // The section heading names the value, so the value sits straight
      // under it, set as the thing the card is about.
      <div>
        <label htmlFor={id} className="sr-only">
          {title}
        </label>
        {control('-my-2.5 inline-flex min-h-11 items-center text-body font-medium')}
      </div>
    ) : (
      <Row title={title} hint={hint} htmlFor={id} stacked>
        {control('text-ui max-sm:min-h-11')}
      </Row>
    )
  );
}
