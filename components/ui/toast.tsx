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
import { Undo2, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The toast, and the undo that lives in it.
 *
 * "Undo beats confirm" is in the design language and until now the app had
 * eight browser confirm() dialogs and one undo. A native dialog is the single
 * most jarring thing a polished interface can do: it stops the world, it
 * wears the browser's clothes, and it asks the person to predict whether they
 * will regret something. An undo lets them find out.
 *
 * So: do the thing, then say so here, with the way back beside it for six
 * seconds. Bottom left, in the status line's monospace voice, because it is
 * the same register -- the system telling you what just happened -- one rung
 * up the attention ladder. Never more than two at once; a third pushes the
 * oldest out.
 *
 * Irreversible actions still confirm, but in place -- see ConfirmStep -- and
 * never through window.confirm.
 */
export type ToastInput = {
  text: string;
  /** Offered for `duration`; when it runs, the toast says `undone`. */
  undo?: () => void | Promise<void>;
  undone?: string;
  /** Milliseconds. Long enough to read and reach for; short enough to forget. */
  duration?: number;
};

type ToastRecord = ToastInput & { id: number; state: 'open' | 'undone' | 'failed' };

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/** A no-op outside the provider, so a component can be rendered anywhere. */
export function useToast(): (toast: ToastInput) => void {
  const push = useContext(ToastContext);
  return useMemo(() => push ?? (() => undefined), [push]);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const counter = useRef(0);

  const push = useCallback((toast: ToastInput) => {
    counter.current += 1;
    const record: ToastRecord = { ...toast, id: counter.current, state: 'open' };
    setToasts((current) => [...current.slice(-1), record]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const settle = useCallback((id: number, state: ToastRecord['state']) => {
    setToasts((current) =>
      current.map((toast) => (toast.id === id ? { ...toast, state } : toast)),
    );
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <Toaster toasts={toasts} dismiss={dismiss} settle={settle} />
    </ToastContext.Provider>
  );
}

function Toaster({
  toasts,
  dismiss,
  settle,
}: {
  toasts: ToastRecord[];
  dismiss: (id: number) => void;
  settle: (id: number, state: ToastRecord['state']) => void;
}) {
  if (toasts.length === 0) return null;

  // Rendered in place rather than portalled: the provider sits at the top of
  // the shell, above anything with a transform, so `fixed` means the viewport.
  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-20 z-toast flex flex-col items-start gap-2 sm:left-6 sm:right-auto lg:bottom-10"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} dismiss={dismiss} settle={settle} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  dismiss,
  settle,
}: {
  toast: ToastRecord;
  dismiss: (id: number) => void;
  settle: (id: number, state: ToastRecord['state']) => void;
}) {
  const [pending, start] = useTransition();
  const [held, setHeld] = useState(false);
  const duration = toast.duration ?? 6000;

  // The clock pauses under the cursor: a person reaching for Undo should not
  // lose it because they read the sentence first.
  useEffect(() => {
    if (held || pending) return;
    const wait = toast.state === 'open' ? duration : 2200;
    const timer = window.setTimeout(() => dismiss(toast.id), wait);
    return () => window.clearTimeout(timer);
  }, [held, pending, toast.id, toast.state, duration, dismiss]);

  function undo() {
    if (!toast.undo || toast.state !== 'open') return;
    const run = toast.undo;
    start(async () => {
      try {
        await run();
        settle(toast.id, 'undone');
      } catch {
        settle(toast.id, 'failed');
      }
    });
  }

  const text =
    toast.state === 'undone'
      ? toast.undone ?? 'undone'
      : toast.state === 'failed'
        ? 'could not undo that'
        : toast.text;

  return (
    <div
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      className={cn(
        'toast-in sheet pointer-events-auto flex w-full sm:w-auto sm:max-w-md items-center gap-3 rounded-lg border bg-raised py-2 pl-3 pr-1.5 font-mono text-micro text-ink shadow-lg',
        toast.state === 'failed' && 'text-danger',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {toast.undo && toast.state === 'open' && (
        <button
          type="button"
          onClick={undo}
          disabled={pending}
          className="press inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-sans text-ui font-semibold text-accent hover:bg-accent-tint disabled:opacity-50"
        >
          <Undo2 className="size-3.5" strokeWidth={1.75} aria-hidden />
          {pending ? 'Undoing…' : 'Undo'}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="press flex size-6 items-center justify-center rounded-md text-ink-muted hover:bg-sunken hover:text-ink"
      >
        <X className="size-3.5" strokeWidth={2} aria-hidden />
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  );
}
