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
import { IconButton } from '@/components/ui/icon-button';
import { ToggleChip, toggleChipClass } from '@/components/ui/chip';
import { FieldError } from '@/components/ui/field';
import { popoverSurface, scrim } from '@/components/ui/popover';
import { PaidCostsProvider, PaidHint } from '@/components/ui/paid-hint';
import { Kbd } from '@/components/ui/kbd';
import { AddFile } from '@/components/attachments/add-file';
import type { UploadedAttachment } from '@/lib/attachments/rules';
import {
  CaptureFoot,
  CaptureHeader,
  FiledCaptures,
  PlaceLine,
  type PlaceGuess,
} from '@/components/shell/capture-places';
import { usePopover } from '@/lib/use-popover';
import {
  aimProblem,
  availableCaptureActions,
  CAPTURE_KINDS,
  DEFAULT_CAPTURE_ACTION,
  type CaptureAction,
  type CaptureActionId,
  type CaptureAim,
} from '@/lib/capture/actions';
import { AimedCaptureForm, CaptureAimContext, DayChips } from '@/components/shell/capture-aim';
import { useToast, type ToastInput } from '@/components/ui/toast';
import { useRouter } from 'next/navigation';
import { todoCaptureForm, type CaptureDay } from '@/lib/capture/todo';
import { captureDestination, type CaptureDestination } from '@/lib/capture/destination';
import { goalsPlaceName } from '@/lib/capture/destination';
import {
  offeredCapturePlaces,
  type FiledCapture,
} from '@/lib/capture/place';
import { CAPTURE_PLACE_MODULE, type CapturePlace, type CaptureSort } from '@/lib/capture/sort';
import { sendToPlace } from '@/components/motion/place';
import { landingTarget } from '@/components/motion/settle';
import type { PaidCosts } from '@/lib/core/spend/paid-actions';
import { describeFiled, estimateAsked, type FiledEntry } from '@/lib/goals/capture';
import {
  ESTIMATE_CHIPS,
  ESTIMATE_QUESTION,
  PROGRESS_ESTIMATES,
  type ProgressEstimate,
} from '@/lib/goals/progress';
import {
  CAPTURE_MOVE_LABELS,
  CAPTURE_MOVES,
  CAPTURE_SORT_DEBOUNCE_MS,
  CAPTURE_SORT_MIN_CHARS,
  type CaptureGuess,
  type CaptureMove,
} from '@/lib/goals/capture-sort';
import type { ModuleId } from '@/lib/modules';
import { addTask, type TaskFormState } from '@/app/todo/actions';
import { addQuickNote } from '@/app/vault/actions';
import {
  fileGoalCapture,
  goalCaptureCosts,
  estimateGoalCapture,
  sortGoalCapture,
  undoGoalCapture,
  type CaptureMoveHint,
} from '@/app/goals/capture-actions';
import {
  captureBoxCosts,
  fileCaptureBox,
  makeAimedCapture,
  sortCaptureBox,
  undoCaptureBox,
} from '@/app/capture-actions';
import { Tooltip } from '@/components/ui/tooltip';

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
  /** Open it aimed at a kind, from an Add button on a list (plan #1950.1). */
  aim: (aim: CaptureAim) => void;
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
  /** An Add button's aim, while its panel is open (plan #1950.1). */
  const [aimed, setAimed] = useState<CaptureAim | null>(null);
  const toast = useToast();
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
      setAimed(null);
      setSession({ action, seed });
    },
    [actions],
  );

  const close = useCallback(() => {
    setSession(null);
    setAimed(null);
  }, []);

  /**
   * Open capture aimed at a kind. A kind that makes one row opens the aimed
   * panel; a goal update, which files against several, opens its own panel
   * as the palette does, since its lines each carry their own Undo.
   */
  const aim = useCallback(
    (target: CaptureAim) => {
      const kind = CAPTURE_KINDS[target.kind];
      if (!kind) return;
      if (kind.makes === 'filing') {
        const action = actions.find((a) => a.id === kind.action);
        if (action) setSession({ action, seed: target.seed ?? '' });
        return;
      }
      setSession(null);
      setAimed(target);
    },
    [actions],
  );

  // A row an aimed add made in another workspace's shell: its toast again here.
  useEffect(() => {
    const notice = carriedToast();
    if (notice) toast(notice);
  }, [toast]);
  /** Where the one box can file for this account (plan #1581). */
  const places = useMemo(
    () =>
      offeredCapturePlaces(
        moduleKey === undefined ? undefined : (moduleKey.split(',').filter(Boolean) as ModuleId[]),
      ),
    [moduleKey],
  );

  const handle = useMemo<CaptureHandle>(
    () => ({ open, aim, close, actions }),
    [open, aim, close, actions],
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
  const covering = session !== null || aimed !== null;
  useEffect(() => {
    if (!covering) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [covering]);

  return (
    <CaptureContext.Provider value={handle}>
      <CaptureAimContext.Provider value={aim}>{children}</CaptureAimContext.Provider>
      {aimed && (
        <AimedPanel
          // A fresh panel per aim, so a second Add starts empty.
          key={`${aimed.kind}:${aimed.role?.id ?? ''}`}
          aim={aimed}
          onClose={close}
        />
      )}
      {session && session.action.id === 'anything' && (
        <AnythingPanel
          key={session.action.id}
          session={session}
          actions={actions}
          places={places}
          onSwitch={(action) => setSession({ action, seed: '' })}
          onClose={close}
        />
      )}
      {session && session.action.id !== 'anything' && (
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
async function file(
  action: CaptureAction,
  text: string,
  day: CaptureDay,
  hint: CaptureMoveHint,
): Promise<FileResult> {
  switch (action.id) {
    case 'todo':
      return addTask({}, todoCaptureForm(text, day));
    case 'goals': {
      const result = await fileGoalCapture(text, hint);
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
    case 'vault': {
      // The Vault page's own write, so the note waits in Quick note triage.
      const result = await addQuickNote(text);
      return result.error ? { error: result.error } : { message: 'Added to Quick note triage.' };
    }
    case 'anything':
      // The one box files through fileCaptureBox, in AnythingPanel.
      return { error: 'Nothing was filed.' };
  }
}

/**
 * Show where a filed item went (plan #1330): a puff where it was typed, a chip
 * carrying its first words to the destination, which then pulses once and is
 * named beside it, "Todo · Today".
 *
 * The destination is the workspace's own nav row when it is on screen and the
 * workspace switcher when it is not (landingTarget). The pieces are the
 * shared ones in components/motion/, played in order by sendToPlace. All of
 * it is chrome: it runs after the save has been confirmed and nothing waits
 * on it. Under
 * reduced motion the puff and the flight resolve at once without drawing, so
 * the name appears straight away and is the only thing that does.
 *
 * `from` is the field's rect taken before the panel changed, since an
 * element that has gone has no size and the helpers skip it silently.
 */
function showLanding(from: DOMRectReadOnly | undefined, where: CaptureDestination, text: string) {
  void sendToPlace({ from, to: landingTarget(where.href), label: text, name: where.name });
}

/**
 * The overlay contract both panels keep: focus back where it was on close,
 * and escape, outside-click and the focus trap from `usePopover`.
 */
function usePanelChrome(onClose: () => void, panelRef: React.RefObject<HTMLFormElement | null>) {
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
  const sorting = useMoveGuess(action.id === 'goals' ? text : null);
  /** The move the person picked when the guess was unsure, or to overrule it. */
  const [picked, setPicked] = useState<CaptureMove | null>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  usePanelChrome(onClose, panelRef);

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
      const hint: CaptureMoveHint = picked
        ? { move: picked, picked: true }
        : sorting.guess?.sure
          ? { move: sorting.guess.move, picked: false }
          : null;
      const result = await file(action, text, day, hint);
      setState(result);
      if (!result.message) return;
      const added = result.filed;
      const from = fieldRef.current?.getBoundingClientRect();
      const where = captureDestination(action, { day, entries: added?.entries });
      if (added) setFiled((list) => [added, ...list]);
      setText('');
      setPicked(null);
      // Back to the default rather than to blank: the panel stays open for
      // the next thing, and the next thing is a fresh answer to "when".
      setDay('today');
      fieldRef.current?.focus();
      if (where) showLanding(from, where, text);
    });
  }

  function retype(value: string) {
    setText(value);
    // A pick was about the sentence as it stood; an emptied box starts over.
    if (!value.trim()) setPicked(null);
    // The last result was about the last thing typed.
    if (state.error || state.message) setState({});
  }

  function changed(captureId: string, entries: FiledEntry[]) {
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
        <CaptureHeader action={action} actions={actions} onSwitch={onSwitch} />

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

        {action.id === 'goals' && (
          <MoveGuess guess={sorting.guess} picked={picked} onPick={setPicked} />
        )}

        {/* The two days that are most of what anyone ever answers "when" with,
            one press each, and the same question asked in full beside them --
            the shape the add form on /todo already uses, so "when" is answered
            the same way in both places. The chips send the word rather than a
            date, because the shell is not handed the account's today; see
            lib/capture/todo.ts. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-border px-3 py-2">
          {action.dated && <DayChips day={day} onDay={setDay} />}

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
              <FiledLines key={item.captureId} filed={item} onChanged={changed} />
            ))}
          </div>
        )}
      </form>
    </div>
  );
}

/**
 * The one box (plan #1581): type anything, and Dash files it as a todo, a
 * goal update or a note on a job.
 *
 * As you type, the line under the field says where it will go
 * (usePlaceGuess); when Dash is not sure it offers the places as chips
 * instead. Enter files, through fileCaptureBox, and the list underneath says
 * where each thing went with an Undo. Shift-Enter is a new line, since what
 * is typed here is as often a sentence as a title.
 */
function AnythingPanel({
  session,
  actions,
  places,
  onSwitch,
  onClose,
}: {
  session: Session;
  actions: readonly CaptureAction[];
  places: readonly CapturePlace[];
  onSwitch: (action: CaptureAction) => void;
  onClose: () => void;
}) {
  const { action, seed } = session;
  const [text, setText] = useState(seed);
  /** What this panel has filed since it opened, newest first. */
  const [filed, setFiled] = useState<FiledCapture[]>([]);
  const [costs, setCosts] = useState<PaidCosts>({});
  useEffect(() => {
    let live = true;
    captureBoxCosts()
      .then((found) => {
        if (live) setCosts(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const { guess: guessed, places: sortedPlaces } = usePlaceGuess(text);
  /** The places Enter came back with when it asked. */
  const [askedPlaces, setAskedPlaces] = useState<readonly CapturePlace[] | null>(null);
  // The server's list once it has answered: it alone knows whether the vault
  // can be written (plan #1582), so the box's own list never has it.
  const offered = askedPlaces ?? (sortedPlaces && sortedPlaces.length > 0 ? sortedPlaces : places);
  /** The sort Enter came back with when Dash was not sure, which asks for a pick. */
  const [asked, setAsked] = useState<CaptureSort | null | undefined>(undefined);
  const [picked, setPicked] = useState<CapturePlace | null>(null);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  /** What "Add a file" has put in the bucket for the next filing (plan #1714). */
  const [uploads, setUploads] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const panelRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  usePanelChrome(onClose, panelRef);

  const guess: PlaceGuess = asked !== undefined ? { state: 'answered', sort: asked } : guessed;

  function submit() {
    if (pending || !text.trim()) return;
    // A file still going up would be left behind, so Enter waits for it.
    if (uploading) {
      setMessage('Adding the file first.');
      return;
    }
    const sort = guess.state === 'answered' ? guess.sort : null;
    // Dash has said it is not sure and nothing is picked: the line is
    // already asking, so Enter waits for the answer rather than guessing.
    if (guess.state === 'answered' && !picked && !sort?.sure) {
      setMessage('Pick where it goes.');
      return;
    }
    start(async () => {
      const result = await fileCaptureBox(text, { sort: sort?.sure ? sort : null, picked }, uploads);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.ask) {
        setAsked(result.ask.sort);
        if (result.ask.places.length > 0) setAskedPlaces(result.ask.places);
        setMessage('Pick where it goes.');
        return;
      }
      if (result.filed.length === 0) {
        setError(result.errors[0] ?? 'Nothing was filed.');
        return;
      }
      const from = fieldRef.current?.getBoundingClientRect();
      const first = result.filed[0];
      setFiled((list) => [...result.filed, ...list]);
      setMessage(undefined);
      setError(result.errors[0] ?? null);
      setText('');
      setUploads([]);
      setPicked(null);
      setAsked(undefined);
      fieldRef.current?.focus();
      // The box files only what the sort placed, so a part always has a place.
      if (first.place) {
        showLanding(from, { module: CAPTURE_PLACE_MODULE[first.place], href: first.href, name: first.where }, text);
      }
    });
  }

  function retype(value: string) {
    setText(value);
    if (!value.trim()) setPicked(null);
    // What Enter asked about was the sentence as it stood.
    if (asked !== undefined) setAsked(undefined);
    if (error || message) {
      setError(null);
      setMessage(undefined);
    }
  }

  function undo(item: FiledCapture) {
    const id = item.actionId;
    if (!id) return;
    setUndoing(id);
    setUndoError(null);
    start(async () => {
      const result = await undoCaptureBox(id);
      setUndoing(null);
      if (!result.ok) {
        setUndoError(result.error);
        return;
      }
      setFiled((list) =>
        list.map((other) => (other.actionId === id ? { ...other, undoneAt: result.undoneAt } : other)),
      );
    });
  }

  function goalsChanged(captureId: string, entries: FiledEntry[]) {
    setFiled((list) =>
      list.map((item) =>
        item.goals?.captureId === captureId ? { ...item, goals: { captureId, entries } } : item,
      ),
    );
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center px-4 pt-[12vh]">
      <button type="button" aria-label="Close" onClick={onClose} className={scrim} />
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
        <CaptureHeader action={action} actions={actions} onSwitch={onSwitch} />
        <textarea
          ref={(node) => {
            fieldRef.current = node;
          }}
          value={text}
          onChange={(event) => retype(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={action.placeholder}
          aria-label={action.label}
          rows={3}
          data-focus-ring="none"
          className="w-full resize-none bg-transparent px-3 py-3 text-body text-ink outline-none placeholder:text-ink-ghost"
        />
        <PlaceLine guess={guess} places={offered} picked={picked} onPick={setPicked} />
        <CaptureFoot
          message={message}
          pending={pending && undoing === null}
          costs={costs}
          files={
            <AddFile
              value={uploads}
              onChange={setUploads}
              disabled={pending}
              onUploadingChange={setUploading}
            />
          }
        />
        {error && (
          <div className="px-3 pb-2">
            <FieldError>{error}</FieldError>
          </div>
        )}
        <FiledCaptures
          filed={filed}
          busy={undoing}
          error={undoError}
          onUndo={undo}
          goalLines={(item) =>
            item.goals ? (
              <FiledLines
                filed={item.goals}
                onChanged={goalsChanged}
                withinGoal={goalsPlaceName(item.goals.entries)}
              />
            ) : null
          }
        />
      </form>
    </div>
  );
}

/**
 * Where Dash will put the sentence as it stands, asked once typing has
 * paused for CAPTURE_SORT_DEBOUNCE_MS, the same pacing as the goals box's
 * guess below. Each answer is kept for the text it was asked about, so a late
 * answer is never shown against a different sentence and going back to one
 * already asked about does not ask again.
 */
function usePlaceGuess(text: string): { guess: PlaceGuess; places: readonly CapturePlace[] | null } {
  const [answers, setAnswers] = useState<ReadonlyMap<string, CaptureSort | null>>(new Map());
  /** The places the server offered with its latest answer. */
  const [places, setPlaces] = useState<readonly CapturePlace[] | null>(null);
  const sentence = text.trim();
  const ready = sentence.length >= CAPTURE_SORT_MIN_CHARS;
  const known = answers.has(sentence);

  useEffect(() => {
    if (!ready || known) return;
    let live = true;
    const timer = setTimeout(() => {
      sortCaptureBox(sentence)
        .catch(() => null)
        .then((answer) => {
          if (!live) return;
          if (answer && answer.places.length > 0) setPlaces(answer.places);
          setAnswers((held) => new Map(held).set(sentence, answer?.sort ?? null));
        });
    }, CAPTURE_SORT_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [ready, known, sentence]);

  if (!ready) return { guess: { state: 'idle' }, places };
  if (!known) return { guess: { state: 'reading' }, places };
  return { guess: { state: 'answered', sort: answers.get(sentence) ?? null }, places };
}

/**
 * Jev's guess at what the sentence will do, for the text as it stands
 * (plan #1177).
 *
 * Asked once typing has paused for CAPTURE_SORT_DEBOUNCE_MS, not on every
 * keystroke: each pause is one call, and a sentence typed straight through is
 * one or two. A guess is kept only for the text it was asked about, so an
 * answer that arrives after more typing is dropped rather than shown against
 * the wrong sentence, and going back to a sentence already asked about does
 * not ask again. Null `text` (another action) asks nothing.
 */
function useMoveGuess(text: string | null): { guess: CaptureGuess | null } {
  const [answers, setAnswers] = useState<ReadonlyMap<string, CaptureGuess | null>>(new Map());
  const sentence = text?.trim() ?? '';
  const ready = text !== null && sentence.length >= CAPTURE_SORT_MIN_CHARS;
  const known = answers.has(sentence);

  useEffect(() => {
    if (!ready || known) return;
    let live = true;
    const timer = setTimeout(() => {
      sortGoalCapture(sentence)
        .catch(() => null)
        .then((guess) => {
          if (!live) return;
          setAnswers((held) => new Map(held).set(sentence, guess));
        });
    }, CAPTURE_SORT_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [ready, known, sentence]);

  return { guess: ready ? (answers.get(sentence) ?? null) : null };
}

/**
 * The guess under the field. Sure: it says what filing will do. Unsure: it
 * asks, with the five moves as chips. A pick overrules either, and pressing
 * the picked chip again takes it back. Filing without a pick is always
 * allowed; the sentence then goes to Haiku with no hint, as it did before.
 */
function MoveGuess({
  guess,
  picked,
  onPick,
}: {
  guess: CaptureGuess | null;
  picked: CaptureMove | null;
  onPick: (move: CaptureMove | null) => void;
}) {
  if (!guess && !picked) return null;
  const asking = !picked && guess && !guess.sure;

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-border px-3 py-2 text-small">
      {picked ? (
        <span className="text-ink-muted">Filing as</span>
      ) : guess?.sure ? (
        <span className="text-ink-muted">
          Dash reads this as{' '}
          <span className="font-medium text-ink">{CAPTURE_MOVE_LABELS[guess.move]}</span>
          <span className="tabular"> · {Math.round(guess.confidence * 100)}% sure</span>
        </span>
      ) : (
        <span className="text-ink-muted">Dash is not sure what this does. Which is it?</span>
      )}
      {(asking || picked) &&
        CAPTURE_MOVES.map((move) => {
          const on = picked === move;
          return (
            <ToggleChip key={move} on={on} onClick={() => onPick(on ? null : move)}>
              {CAPTURE_MOVE_LABELS[move]}
            </ToggleChip>
          );
        })}
      {guess?.sure && !picked && (
        <Button type="button" variant="ghost" size="xs" onClick={() => onPick(guess.move)} className="ml-auto">
          Change
        </Button>
      )}
    </div>
  );
}

/**
 * What one sentence was filed as, each line with its own Undo.
 *
 * The model will sometimes log progress on the wrong step, so every line
 * can be reversed on its own, in one press, without touching the others. An
 * undone line stays in the list, marked, because the capture keeps it too.
 *
 * The first progress on a step with no total also asks once how far along
 * it is (plan #1280), as three chips under the line. A tap keeps the answer
 * and the chips go; leaving them is a fine answer too, and the question is
 * not asked again for that step.
 */
export function FiledLines({
  filed,
  onChanged,
  withinGoal,
}: {
  filed: Filed;
  onChanged: (captureId: string, entries: FiledEntry[]) => void;
  /**
   * The goal the heading above already names, in the one box: its lines
   * leave that name out rather than say it twice (plan #1581), and drop
   * their own side padding to line up with the rows around them.
   */
  withinGoal?: string;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [answering, setAnswering] = useState<number | null>(null);
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
      onChanged(filed.captureId, result.filed);
    });
  }

  function answer(index: number, estimate: ProgressEstimate) {
    setAnswering(index);
    setError(null);
    start(async () => {
      const result = await estimateGoalCapture(filed.captureId, index, estimate);
      setAnswering(null);
      if (result.error || !result.filed) {
        setError(result.error ?? 'That could not be kept.');
        return;
      }
      onChanged(filed.captureId, result.filed);
    });
  }

  if (filed.entries.length === 0) return null;

  return (
    <div className={withinGoal === undefined ? 'px-3 py-2' : 'pt-1'}>
      <ul className="space-y-1">
        {filed.entries.map((entry, index) => (
          <li key={index} className="text-small">
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  'min-w-0 flex-1 py-1',
                  entry.undone_at ? 'text-ink-muted line-through' : 'text-ink',
                )}
              >
                {withinGoal !== undefined && entry.goal_title === withinGoal
                  ? describeFiledWithin(entry)
                  : describeFiled(entry)}
              </span>
              {entry.undone_at ? (
                <span className="shrink-0 px-2.5 py-1 text-ink-muted">Undone</span>
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
            </div>
            {estimateAsked(entry) && (
              <div
                role="group"
                aria-label={ESTIMATE_QUESTION}
                className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pb-1"
              >
                <span className="text-ink-muted">{ESTIMATE_QUESTION}</span>
                {PROGRESS_ESTIMATES.map((estimate) => (
                  <button
                    key={estimate}
                    type="button"
                    disabled={answering !== null}
                    onClick={() => answer(index, estimate)}
                    className={cn(toggleChipClass(false), 'disabled:opacity-50')}
                  >
                    {ESTIMATE_CHIPS[estimate]}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

/** A filed line without the goal's name, for under a heading that names it. */
function describeFiledWithin(entry: FiledEntry): string {
  const goal = entry.goal_title;
  return describeFiled(entry)
    .replace(` in ${goal}`, '')
    .replace(` against ${goal}`, '')
    .replace(` for ${goal}`, '')
    .replace(` on ${goal}`, '');
}

/**
 * The toast for a row an aimed add just made, kept outside React for a few
 * seconds. Opening the row's page can leave the workspace, and each
 * workspace's layout mounts its own shell, so the toast that was showing goes
 * with the old one. The provider that mounts next shows it again, so Undo is
 * still there on the row's own page.
 */
const CARRY_MS = 6000;
let carried: { toast: ToastInput; at: number } | null = null;

function carryToast(toast: ToastInput) {
  carried = { toast, at: Date.now() };
}

/** The carried toast, while it is still fresh, for a provider that has just mounted. */
function carriedToast(): ToastInput | null {
  if (!carried || Date.now() - carried.at > CARRY_MS) {
    carried = null;
    return null;
  }
  return carried.toast;
}

/**
 * Capture aimed at a kind (plan #1950.1): what an Add button on a list
 * opens. The kind is already chosen, so there is no sort and no place chips:
 * the title, the one more thing the kind needs, and Add. One press makes the
 * row; the panel closes, the chip flies from the field to the kind's
 * section, the toast says where it went with Undo, and the row's page opens.
 *
 * A failure keeps the panel open with the text where it was, as the other
 * panels do.
 */
function AimedPanel({ aim, onClose }: { aim: CaptureAim; onClose: () => void }) {
  const kind = CAPTURE_KINDS[aim.kind];
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState(aim.seed ?? '');
  const [day, setDay] = useState<CaptureDay>('today');
  const [error, setError] = useState<string | null>(aimProblem(aim));
  const [pending, start] = useTransition();
  const panelRef = useRef<HTMLFormElement>(null);
  // A kind whose press reads with a model shows its $ figure, asked for once
  // when the panel opens, as the one box asks for its own (plan #1950.3.1).
  const [costs, setCosts] = useState<PaidCosts>({});
  useEffect(() => {
    if (!kind.paid) return;
    let live = true;
    captureBoxCosts()
      .then((found) => {
        if (live) setCosts(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [kind.paid]);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  usePanelChrome(onClose, panelRef);

  function submit() {
    if (pending || !text.trim()) return;
    const problem = aimProblem(aim);
    if (problem) {
      setError(problem);
      return;
    }
    start(async () => {
      const result = await makeAimedCapture({
        kind: aim.kind,
        text,
        ...(kind.needs === 'day' ? { day } : {}),
        ...(aim.role ? { role: aim.role } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const made = result.filed;
      const from = fieldRef.current?.getBoundingClientRect();
      const origin = `${window.location.pathname}${window.location.search}`;
      const page = made.page ?? null;
      const actionId = made.actionId;
      const notice: ToastInput = {
        text: result.errors[0] ?? `Added to ${made.where}.`,
        undone: 'Taken back.',
        ...(actionId
          ? {
              undo: async () => {
                carried = null;
                const undone = await undoCaptureBox(actionId);
                if (!undone.ok) throw new Error(undone.error);
                // The row's page has nothing on it now: back to the list.
                if (page && window.location.pathname === page.split('?')[0]) router.push(origin);
                else router.refresh();
              },
            }
          : {}),
      };
      onClose();
      void sendToPlace({ from, to: landingTarget(kind.section), label: text, name: made.where });
      toast(notice);
      if (page) {
        carryToast(notice);
        router.push(page);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="fixed inset-0 z-modal flex items-start justify-center px-4 pt-[12vh]">
      <button type="button" aria-label="Close" onClick={onClose} className={scrim} />
      <form
        ref={panelRef}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={kind.label}
        tabIndex={-1}
        className={cn(popoverSurface, 'relative w-full max-w-lg overflow-hidden shadow-2xl')}
      >
        <AimedCaptureForm
          kind={kind}
          role={aim.role}
          text={text}
          onText={(value) => {
            setText(value);
            if (error && !aimProblem(aim)) setError(null);
          }}
          day={day}
          onDay={setDay}
          pending={pending}
          error={error}
          fieldRef={(node) => {
            fieldRef.current = node;
          }}
          onSubmit={submit}
          hint={
            kind.paid ? (
              <PaidCostsProvider costs={costs}>
                <PaidHint action="app/capture-actions.ts#makeAimedCapture" what="Cost of reading it" align="end" />
              </PaidCostsProvider>
            ) : null
          }
        />
      </form>
    </div>
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
      <Tooltip label="Capture something, or press ⌥C">
        <IconButton
          label="Capture something"
          onClick={() => open()}
          className="text-shell-muted hover:bg-shell-hover hover:text-shell-ink"
        >
          <Plus strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Capture something</span>
        </IconButton>
      </Tooltip>
      <Kbd className="pointer-events-none absolute left-1/2 top-full hidden -translate-x-1/2 bg-raised sm:block">
        ⌥C
      </Kbd>
    </span>
  );
}
