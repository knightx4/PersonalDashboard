'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import {
  columnFoldedServerSnapshot,
  columnFoldedSnapshot,
  foldedForView,
  rememberColumnFolded,
  type FoldPress,
  subscribeToColumnFolded,
} from '@/lib/vault/open-folders';

/**
 * Folding the note list away on a laptop, so the note has the width (#1379).
 *
 * Three pieces share one flag: the column, the fold button beside its search
 * box, and the unfold button in the note's header row, in the place the
 * phone's "Browse the vault" button takes below `lg`. They sit in different
 * parts of the page, and the page itself stays a server component, so the flag
 * travels by context from `NoteListFold`, which wraps the column and the note.
 *
 * The flag lives in `useFoldedFlag` and nowhere else. It is kept in this
 * browser's storage (#1381, `lib/vault/open-folders.ts`), so a fold lasts from
 * note to note and through a reload until it is undone. The server cannot know
 * it, so the page is drawn unfolded and a stored fold applies once the script
 * has run. Without JavaScript the fold button is not drawn, because it could
 * not work, and the column shows as it always has.
 *
 * Folding hides the column rather than unmounting it, so unfolding puts back
 * exactly what was there: the search box with whatever is typed in it and the
 * folders left open. The note widens through `data-folded` on the wrapper,
 * which the article reads with a `group-data` variant and so stays server
 * markup.
 *
 * Below `lg` neither button is drawn and the column is hidden anyway, so a
 * folded flag changes nothing on a phone.
 */

/** The column's id, which both buttons name in `aria-controls`. */
export const NOTE_LIST_ID = 'vault-note-list';

type FoldState = {
  folded: boolean;
  /** Fold or unfold, and hand focus to the button that press draws. */
  setFolded: (folded: boolean) => void;
  /** True once for the button the last press asked to focus. */
  claimFocus: (which: 'fold' | 'unfold') => boolean;
};

const FoldContext = createContext<FoldState | null>(null);

/**
 * The fold for the note in front of you. The rule is `foldedForView`; this
 * hook feeds it.
 *
 * A press is held in state for the note it was made on as well as written to
 * storage. The state change is what re-renders the page after the write, and
 * it keeps a fold working on its own note where storage is blocked; the next
 * note reads storage again, which there says shown.
 *
 * Whether a search was in the address is taken when the note is arrived at,
 * not on every render: the search box writes to the address as you type, and
 * clearing a search you arrived with must not fold the list away under you.
 */
function useFoldedFlag(notePath: string, search: boolean): [boolean, (folded: boolean) => void] {
  const stored = useSyncExternalStore(
    subscribeToColumnFolded,
    columnFoldedSnapshot,
    columnFoldedServerSnapshot,
  );
  const [pressed, setPressed] = useState<FoldPress | null>(null);
  const [arrival, setArrival] = useState({ notePath, search });
  if (arrival.notePath !== notePath) {
    // Arriving at another note: what was pressed on the last one is done with.
    setArrival({ notePath, search });
    setPressed(null);
  }
  const arrivedWithSearch = arrival.notePath === notePath ? arrival.search : search;

  const folded = foldedForView({ notePath, arrivedWithSearch, stored, pressed });

  function setFolded(next: boolean) {
    rememberColumnFolded(next);
    setPressed({ notePath, folded: next });
  }

  return [folded, setFolded];
}

/** False on the server and in the first render; true once the script runs. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToColumnFolded,
    () => true,
    () => false,
  );
}

function useFold(): FoldState {
  const state = useContext(FoldContext);
  if (!state) throw new Error('The note list fold controls need a NoteListFold around them.');
  return state;
}

export function NoteListFold({
  notePath,
  search = '',
  children,
}: {
  /** The note on the page, so a press holds for the note it was made on. */
  notePath: string;
  /** The search in the address, if any: one there on arrival opens the list. */
  search?: string;
  children: ReactNode;
}) {
  const [folded, setFlag] = useFoldedFlag(notePath, search !== '');
  const focusNextRef = useRef<'fold' | 'unfold' | null>(null);

  function setFolded(next: boolean) {
    focusNextRef.current = next ? 'unfold' : 'fold';
    setFlag(next);
  }

  function claimFocus(which: 'fold' | 'unfold'): boolean {
    if (focusNextRef.current !== which) return false;
    focusNextRef.current = null;
    return true;
  }

  return (
    <FoldContext value={{ folded, setFolded, claimFocus }}>
      <div data-folded={folded} className="group/note flex gap-8">
        {children}
      </div>
    </FoldContext>
  );
}

/** The column beside the note, from `lg` up, gone while the list is folded. */
export function NoteListColumn({ children }: { children: ReactNode }) {
  const { folded } = useFold();
  return (
    <aside
      id={NOTE_LIST_ID}
      aria-label="Vault"
      className={cn('hidden w-60 shrink-0', !folded && 'lg:block')}
    >
      {children}
    </aside>
  );
}

/**
 * Moves focus to `which` once it is drawn, if the last press asked for it.
 *
 * Each button hides itself when pressed, and a keyboard user whose focus was
 * on it would otherwise be dropped back at the top of the page.
 */
function useTakesFocus(which: 'fold' | 'unfold', drawn: boolean) {
  const { claimFocus } = useFold();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (drawn && claimFocus(which)) ref.current?.focus();
  }, [drawn, claimFocus, which]);
  return ref;
}

/** Beside the search box at the top of the column: folds the list away. */
export function FoldNoteListButton() {
  const { folded, setFolded } = useFold();
  const hydrated = useHydrated();
  const ref = useTakesFocus('fold', hydrated && !folded);
  if (!hydrated) return null;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => setFolded(true)}
      title="Hide the note list"
      aria-expanded={!folded}
      aria-controls={NOTE_LIST_ID}
      className="press hidden size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors duration-quick hover:bg-sunken hover:text-ink lg:flex"
    >
      <PanelLeftClose className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">Hide the note list</span>
    </button>
  );
}

/** In the header row beside "All notes", while the list is folded. */
export function UnfoldNoteListButton() {
  const { folded, setFolded } = useFold();
  const ref = useTakesFocus('unfold', folded);
  if (!folded) return null;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => setFolded(false)}
      aria-expanded={false}
      aria-controls={NOTE_LIST_ID}
      className={cn(
        buttonVariants({ variant: 'secondary', size: 'sm' }),
        'hidden shrink-0 lg:inline-flex',
      )}
    >
      <PanelLeftOpen className="size-4" strokeWidth={1.75} aria-hidden />
      Show the note list
    </button>
  );
}
