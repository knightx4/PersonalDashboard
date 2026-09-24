'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { Plus, Undo2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { popoverSurface, scrim } from '@/components/ui/popover';
import { ModuleMark } from '@/components/ui/module-mark';
import { PaidCostsProvider, PaidHint } from '@/components/ui/paid-hint';
import { Kbd } from '@/components/shell/key-hints';
import { usePopover } from '@/lib/use-popover';
import {
  availableCaptureActions,
  DEFAULT_CAPTURE_ACTION,
  type CaptureAction,
  type CaptureActionId,
} from '@/lib/capture/actions';
import { isCalendarDay, todoCaptureForm, type CaptureDay } from '@/lib/capture/todo';
import type { PaidCosts } from '@/lib/core/spend/paid-actions';
import { describeFiled, type FiledEntry } from '@/lib/goals/capture';
import type { ModuleId } from '@/lib/modules';
import { addTask, type TaskFormState } from '@/app/todo/actions';
import { fileGoalCapture, goalCaptureCosts, undoGoalCapture } from '@/app/goals/capture-actions';
import type { RelativeDay } from '@/lib/todo/tasks/model';

/**
 * Write it down here, wherever you are.
 *
 * The shortcut is ⌥C, which puts it in the same family as the ⌥1–9 that jump
 * between a workspace's sections rather than inventing a third modifier, and
 * leaves ⌘K alone: the palette is the picker, and picking "Add a todo" there
 * opens this. Read by `event.code`, because on a Mac ⌥C types "ç" rather than
 * a C -- the same reason the section jumps read codes.
 *
 * The panel is the palette's shape (a scrim, a floating surface a twelfth of
 * the way down) rather than a third kind of overlay, and it takes escape,
 * outside-click, the focus trap and the return of focus from `usePopover`,
 * which is where that contract already lives.
 *
 * -- Why the state is here and not in the shell --
 *
 * Opening this must not re-render the page underneath. The provider holds the
 * open panel, and the shell it wraps arrives as `children`, so a state change
 * here re-renders the provider and React bails out of the identical subtree.
 * The value handed to consumers is two stable callbacks and nothing else, so
 * the header control and the palette do not re-render on open either.
 */

type CaptureHandle = {
  /** Open the panel on an action, optionally with what was already typed. */
  open: (action?: CaptureActionId, seed?: string) => void;
  close: () => void;
  /** The actions this account can use, for the palette's rows. */
  actions: readonly CaptureAction[];
};

const CaptureContext = createContext<CaptureHandle | null>(null);

export function useCapture(): CaptureHandle {
  const handle = useContext(CaptureContext);
  if (!handle) throw new Error('useCapture must be used inside a CaptureProvider');
  return handle;
}

/** The action being taken dictation for, and what it started with. */
type Session = { action: CaptureAction; seed: string };

/**
 * What the shortcut opens: the default action, or the first this account has
 * when the default's workspace is switched off, or nothing at all.
 */
function defaultSession(actions: readonly CaptureAction[]): Session | null {
  const action = actions.find((a) => a.id === DEFAULT_CAPTURE_ACTION) ?? actions[0];
  return action ? { action, seed: '' } : null;
}

export function CaptureProvider({
  modules,
  children,
}: {
  /** The workspaces this account has; an action for one it lacks is not offered. */
  modules?: readonly ModuleId[];
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(null);
  // Keyed on the list's contents: the shell hands a fresh array on every
  // render, and a new handle each time would re-render every consumer.
  const moduleKey = modules?.join(',');
  const actions = useMemo(
    () =>
      availableCaptureActions(
        moduleKey === undefined ? undefined : (moduleKey.split(',').filter(Boolean) as ModuleId[]),
      ),
    [moduleKey],
  );

  const open = useCallback(
    (id: CaptureActionId = DEFAULT_CAPTURE_ACTION, seed = '') => {
      const action = actions.find((a) => a.id === id);
      if (!action) return;
      setSession({ action, seed });
    },
    [actions],
  );

  const close = useCallback(() => setSession(null), []);

  const handle = useMemo<CaptureHandle>(
    () => ({ open, close, actions }),
    [open, close, actions],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (event.code !== 'KeyC') return;
      // Not while somebody is typing: ⌥C inside a field is a character, and
      // the field the panel itself opens is the first one that would suffer.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      event.preventDefault();
      setSession((current) => (current ? null : defaultSession(actions)));
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [actions]);

  // The page underneath stays exactly where it was while the panel is over it.
  useEffect(() => {
    if (!session) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [session]);

  return (
    <CaptureContext.Provider value={handle}>
      {children}
      {session && (
        <CapturePanel
          // A fresh panel per action: switching from a todo to logging what
          // happened starts with that action's own empty state.
          key={session.action.id}
          session={session}
          actions={actions}
          onSwitch={(action) => setSession({ action, seed: '' })}
          onClose={close}
        />
      )}
    </CaptureContext.Provider>
  );
}

/** One sentence filed into Goals, and the lines it was filed as. */
type Filed = { captureId: string; entries: FiledEntry[] };

/**
 * What the panel did with what you wrote: the sentence shown back for a todo,
 * and for Goals the list of what it was filed as, each line with an Undo.
 */
type FileResult = TaskFormState & { filed?: Filed };

/**
 * What the panel does with what you wrote.
 *
 * Filing is the module's own server action -- `addTask` is the one the add
 * form on /todo submits, `fileGoalCapture` the one Goals files a sentence
 * with -- so nothing here is a second way to write a task or a step. The
 * switch is exhaustive on purpose: the next action in the registry will not
 * compile until it says where what you typed goes.
 */
async function file(action: CaptureAction, text: string, day: CaptureDay): Promise<FileResult> {
  switch (action.id) {
    case 'todo':
      return addTask({}, todoCaptureForm(text, day));
    case 'goals': {
      const result = await fileGoalCapture(text);
      if (result.error || !result.captureId) return { error: result.error ?? 'Nothing was filed.' };
      const entries = result.filed ?? [];
      return {
        message:
          entries.length === 0
            ? 'Kept. Nothing in it matched an open goal.'
            : entries.length === 1
              ? 'Filed as one change.'
              : `Filed as ${entries.length} changes.`,
        filed: { captureId: result.captureId, entries },
      };
    }
  }
}

/** The paid press the panel's File it button makes, where there is one. */
const PAID_PRESS: Partial<Record<CaptureActionId, 'app/goals/capture-actions.ts#fileGoalCapture'>> = {
  goals: 'app/goals/capture-actions.ts#fileGoalCapture',
};

function CapturePanel({
  session,
  actions,
  onSwitch,
  onClose,
}: {
  session: Session;
  actions: readonly CaptureAction[];
  onSwitch: (action: CaptureAction) => void;
  onClose: () => void;
}) {
  const { action, seed } = session;
  const [text, setText] = useState(seed);
  /** What this panel has filed into Goals since it opened, newest first. */
  const [filed, setFiled] = useState<Filed[]>([]);
  /**
   * The $ figure for a paid press. The panel lives in the shell, outside any
   * module's layout that would otherwise hand it over, so it is asked for
   * once when an action that spends is opened.
   */
  const [costs, setCosts] = useState<PaidCosts>({});
  const paid = PAID_PRESS[action.id];
  useEffect(() => {
    if (!paid) return;
    let live = true;
    goalCaptureCosts()
      .then((found) => {
        if (live) setCosts(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [paid]);
  /**
   * Today, until it is told otherwise.
   *
   * Nearly everything written down in a hurry is for today -- that is what
   * writing it down in a hurry means -- and starting blank charged one press
   * for the common answer and none for the rare one. Today is still a toggle,
   * so "no day at all" costs the same one press it always did.
   */
  const [day, setDay] = useState<CaptureDay>('today');
  const [state, setState] = useState<FileResult>({});
  const [pending, start] = useTransition();
  const panelRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  /**
   * Back where you were, on close.
   *
   * `usePopover` offers this, and only fires it while focus is still inside
   * the panel -- which by the time a *conditionally rendered* panel's cleanup
   * runs it is not, because the field has already been removed from the
   * document and focus fell back to the body. So the return is taken here,
   * where the element to go back to is outside the panel and still exists.
   * Declared above the hook, so it reads the field-holder before the hook has
   * moved focus and restores it before the hook's own attempt no-ops.
   */
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => before?.focus?.();
  }, []);

  // No trigger passed: this opens from a shortcut as often as from a button,
  // and the line above already knows which.
  usePopover({ open: true, onClose, panelRef });

  /**
   * File it, and stay open with an empty field.
   *
   * Staying is the whole point of a capture surface: the second thing you
   * think of arrives about a second after the first, and closing on every
   * save means reopening to write it. Escape is how you leave.
   *
   * A failure keeps the text exactly where it is -- the error is nearly
   * always the title, and clearing the box would delete the thing the person
   * came to write down.
   */
  function submit() {
    if (pending) return;
    // An empty box is nothing to file, not a failed save: Enter on it should
    // say nothing rather than answer "Give it a title."
    if (!text.trim()) return;

    start(async () => {
      const result = await file(action, text, day);
      setState(result);
      if (!result.message) return;
      const added = result.filed;
      if (added) setFiled((list) => [added, ...list]);
      setText('');
      // Back to the default rather than to blank: the panel stays open for
      // the next thing, and the next thing is a fresh answer to "when".
      setDay('today');
      fieldRef.current?.focus();
    });
  }

  function retype(value: string) {
    setText(value);
    // The last result was about the last thing typed.
    if (state.error || state.message) setState({});
  }

  function undone(captureId: string, entries: FiledEntry[]) {
    setFiled((list) =>
      list.map((item) => (item.captureId === captureId ? { captureId, entries } : item)),
    );
  }

  const field =
    'w-full bg-transparent px-3 py-3 text-body text-ink outline-none placeholder:text-ink-ghost';

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={scrim}
      />
      <form
        ref={panelRef}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={action.label}
        tabIndex={-1}
        className={cn(popoverSurface, 'relative w-full max-w-lg overflow-hidden shadow-2xl')}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {/* Whose workspace the result belongs to, said the way every other
              row in the shell says it. */}
          <ModuleMark module={action.module} size="sm" />
          <span className="min-w-0 flex-1 truncate text-ui font-medium text-ink">
            {action.label}
          </span>
          {/* The other things this box can take, one press away, so the
              header button and ⌥C reach every action and not only the
              default one. */}
          {actions
            .filter((other) => other.id !== action.id)
            .map((other) => (
              <button
                key={other.id}
                type="button"
                onClick={() => onSwitch(other)}
                className="press flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-small text-ink-muted transition-colors duration-150 hover:bg-accent-tint hover:text-accent"
              >
                <ModuleMark module={other.module} size="sm" />
                {other.label}
              </button>
            ))}
          {/* `always`: inside an open panel there is no modifier being held. */}
          <Kbd always>esc</Kbd>
        </div>

        {/* What the field is, is the action's own answer: a todo is a title,
            a note will be prose. Which is also what decides what Enter does --
            it files a line, and in prose it is a line break, where ⌘↵ files. */}
        {action.field === 'prose' ? (
          <textarea
            ref={(node) => {
              fieldRef.current = node;
            }}
            value={text}
            onChange={(event) => retype(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={action.placeholder}
            aria-label={action.label}
            rows={4}
            // No focus ring: the panel focuses this on open, so the global
            // ring would be drawn permanently rather than ever indicating
            // anything. See globals.css, and the palette's own field.
            data-focus-ring="none"
            className={cn(field, 'resize-none')}
          />
        ) : (
          <input
            ref={(node) => {
              fieldRef.current = node;
            }}
            value={text}
            onChange={(event) => retype(event.target.value)}
            placeholder={action.placeholder}
            aria-label={action.label}
            data-focus-ring="none"
            className={field}
          />
        )}

        {/* The two days that are most of what anyone ever answers "when" with,
            one press each, and the same question asked in full beside them --
            the shape the add form on /todo already uses, so "when" is answered
            the same way in both places. The chips send the word rather than a
            date, because the shell is not handed the account's today; see
            lib/capture/todo.ts. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-border px-3 py-2">
          {action.dated && (
            <>
              <DayChip label="Today" day="today" picked={day} onPick={setDay} />
              <DayChip label="Tomorrow" day="tomorrow" picked={day} onPick={setDay} />

              {/* Unframed and quiet, so a row of chips stays a row of chips
                  rather than growing a boxed field in the middle of it. It
                  shows a date only when a date is what is picked: with Today
                  on, the answer is on the chip. */}
              <input
                type="date"
                aria-label="A specific day"
                value={isCalendarDay(day) ? day : ''}
                onChange={(event) => setDay(event.target.value)}
                className={cn(
                  'tabular rounded-full bg-transparent px-2 py-1 text-small outline-none transition-colors duration-150',
                  'focus:ring-1 focus:ring-accent/40',
                  isCalendarDay(day) ? 'text-ink' : 'text-ink-muted',
                )}
              />
            </>
          )}

          {/* Said here rather than in a toast: this is where the person is
              looking, and an empty field with nothing said about it reads as
              a field that lost what was in it. */}
          <span className="ml-auto flex items-center gap-2">
            <span role="status" aria-live="polite" className="text-small text-ink-muted">
              {state.message}
            </span>
            <Button type="submit" size="sm" pending={pending}>
              <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
              {pending ? 'Filing…' : 'File it'}
            </Button>
            {paid && (
              <PaidCostsProvider costs={costs}>
                <PaidHint action={paid} what="Cost of filing it" align="end" />
              </PaidCostsProvider>
            )}
          </span>
        </div>

        {state.error && (
          <div className="px-3 pb-2">
            <FieldError>{state.error}</FieldError>
          </div>
        )}

        {filed.length > 0 && (
          <div className="max-h-[40vh] overflow-y-auto border-t border-border">
            {filed.map((item) => (
              <FiledLines key={item.captureId} filed={item} onUndone={undone} />
            ))}
          </div>
        )}
      </form>
    </div>
  );
}

/**
 * What one sentence was filed as, each line with its own Undo.
 *
 * The model will sometimes put a note against the wrong goal, so every line
 * can be reversed on its own, in one press, without touching the others. An
 * undone line stays in the list, marked, because the capture keeps it too.
 */
function FiledLines({
  filed,
  onUndone,
}: {
  filed: Filed;
  onUndone: (captureId: string, entries: FiledEntry[]) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function undo(index: number) {
    setBusy(index);
    setError(null);
    start(async () => {
      const result = await undoGoalCapture(filed.captureId, index);
      setBusy(null);
      if (result.error || !result.filed) {
        setError(result.error ?? 'That could not be undone.');
        return;
      }
      onUndone(filed.captureId, result.filed);
    });
  }

  if (filed.entries.length === 0) return null;

  return (
    <div className="px-3 py-2">
      <ul className="space-y-1">
        {filed.entries.map((entry, index) => (
          <li key={index} className="flex items-start gap-2 text-small">
            <span
              className={cn(
                'min-w-0 flex-1 py-1',
                entry.undone_at ? 'text-ink-muted line-through' : 'text-ink',
              )}
            >
              {describeFiled(entry)}
            </span>
            {entry.undone_at ? (
              <span className="shrink-0 py-1 text-ink-muted">Undone</span>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                pending={busy === index}
                onClick={() => undo(index)}
              >
                <Undo2 className="size-3.5" strokeWidth={1.75} aria-hidden />
                Undo
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

/**
 * A day, picked or unpicked in one press.
 *
 * A toggle rather than a pair of radios, the same as the chips on /todo:
 * picking Today and changing your mind has to cost one press, not a trip to a
 * date field to clear it.
 */
function DayChip({
  label,
  day,
  picked,
  onPick,
}: {
  label: string;
  day: RelativeDay;
  picked: CaptureDay;
  onPick: (day: CaptureDay) => void;
}) {
  const on = picked === day;

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onPick(on ? '' : day)}
      className={cn(
        'press rounded-full px-2.5 py-1 text-small font-medium transition-colors duration-150',
        on ? 'bg-accent text-fill-ink' : 'text-ink-muted hover:bg-accent-tint hover:text-accent',
      )}
    >
      {label}
    </button>
  );
}

/**
 * The way in, at every width: an icon in the top bar beside the theme picker.
 *
 * There used to be a second one below `sm` -- an accent circle floating over
 * the foot of every page, on the reasoning that a phone has no modifier to
 * hold. It read as the app insisting you add a todo rather than as a way in,
 * which is the wrong volume for a control that is available everywhere, so it
 * is gone and this one is no longer hidden on a phone. One way in, one place,
 * and nothing pinned over the page.
 *
 * The cap hangs under the button rather than sitting inside it: `.keyhint`
 * fades rather than unmounting, so a cap in the row would reserve its width
 * permanently and leave a gap in the header nobody could see the reason for.
 * It stays an `sm`-and-up thing: there is no ⌥ to press on a phone, so the
 * cap there would name a shortcut that does not exist.
 */
export function CaptureButton() {
  const { open } = useCapture();
  return (
    <span className="relative block shrink-0">
      <button
        type="button"
        onClick={() => open()}
        title="Capture something (⌥C)"
        className="press flex size-8 items-center justify-center rounded-full text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-ink"
      >
        <Plus className="size-4" strokeWidth={1.75} aria-hidden />
        <span className="sr-only">Capture something</span>
      </button>
      <Kbd className="pointer-events-none absolute left-1/2 top-full hidden -translate-x-1/2 bg-raised sm:block">
        ⌥C
      </Kbd>
    </span>
  );
}
