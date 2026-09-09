'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { popoverSurface } from '@/components/ui/popover';
import { ModuleMark } from '@/components/ui/module-mark';
import { Kbd } from '@/components/shell/key-hints';
import { usePopover } from '@/lib/use-popover';
import {
  captureAction,
  DEFAULT_CAPTURE_ACTION,
  type CaptureAction,
  type CaptureActionId,
} from '@/lib/capture/actions';

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
};

const CaptureContext = createContext<CaptureHandle | null>(null);

export function useCapture(): CaptureHandle {
  const handle = useContext(CaptureContext);
  if (!handle) throw new Error('useCapture must be used inside a CaptureProvider');
  return handle;
}

/** The action being taken dictation for, and what it started with. */
type Session = { action: CaptureAction; seed: string };

/** What the shortcut opens: the default action, or nothing if it went away. */
function defaultSession(): Session | null {
  const action = captureAction(DEFAULT_CAPTURE_ACTION);
  return action ? { action, seed: '' } : null;
}

export function CaptureProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);

  const open = useCallback((id: CaptureActionId = DEFAULT_CAPTURE_ACTION, seed = '') => {
    const action = captureAction(id);
    if (!action) return;
    setSession({ action, seed });
  }, []);

  const close = useCallback(() => setSession(null), []);

  const handle = useMemo<CaptureHandle>(() => ({ open, close }), [open, close]);

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
      setSession((current) => (current ? null : defaultSession()));
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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
      {session && <CapturePanel session={session} onClose={close} />}
    </CaptureContext.Provider>
  );
}

function CapturePanel({ session, onClose }: { session: Session; onClose: () => void }) {
  const { action, seed } = session;
  const [text, setText] = useState(seed);
  const panelRef = useRef<HTMLDivElement>(null);

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

  const field =
    'w-full bg-transparent px-3 py-3 text-body text-ink outline-none placeholder:text-ink-ghost';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
      />
      <div
        ref={panelRef}
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
          {/* `always`: inside an open panel there is no modifier being held. */}
          <Kbd always>esc</Kbd>
        </div>

        {/* Nothing is filed from here yet -- the writer is the module's own
            server action and arrives with the step that wires it. What the
            field is, though, is the action's own answer: a todo is a title,
            a note will be prose. */}
        {action.field === 'prose' ? (
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
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
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={action.placeholder}
            aria-label={action.label}
            data-focus-ring="none"
            className={field}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The way in from the top bar, with its shortcut on it.
 *
 * The cap hangs under the button rather than sitting inside it: `.keyhint`
 * fades rather than unmounting, so a cap in the row would reserve its width
 * permanently and leave a gap in the header nobody could see the reason for.
 * From `sm` up -- below that the header is already six controls wide and the
 * thumb has a better way in, below.
 */
export function CaptureButton() {
  const { open } = useCapture();
  return (
    <span className="relative hidden shrink-0 sm:block">
      <button
        type="button"
        onClick={() => open()}
        title="Capture something (⌥C)"
        className="press flex size-8 items-center justify-center rounded-full text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-ink"
      >
        <Plus className="size-4" strokeWidth={1.75} aria-hidden />
        <span className="sr-only">Capture something</span>
      </button>
      <Kbd className="pointer-events-none absolute left-1/2 top-full -translate-x-1/2 bg-raised">
        ⌥C
      </Kbd>
    </span>
  );
}

/**
 * The way in on a phone, where there is no modifier to hold.
 *
 * Above the tab bar and under the thumb, rather than a seventh icon in a top
 * bar that is out of reach one-handed. Below `sm` only: from there up the
 * header control is the way in, and two of them on one screen would be two
 * answers to the same question.
 */
export function CaptureFab() {
  const { open } = useCapture();
  return (
    <button
      type="button"
      onClick={() => open()}
      className="press fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex size-12 items-center justify-center rounded-full bg-accent text-surface shadow-lg sm:hidden"
    >
      <Plus className="size-5" strokeWidth={2} aria-hidden />
      <span className="sr-only">Capture something</span>
    </button>
  );
}
