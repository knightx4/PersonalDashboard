'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { paletteHits } from '@/lib/search/rank';
import { score } from '@/lib/search/score';
import { MIN_QUERY, type SearchHit } from '@/lib/search/sources';
import {
  SCOPE_PARAM,
  commandsInScope,
  hitsInScope,
  moduleInScope,
  type SearchScope,
} from '@/lib/search/scope';
import { useCapture } from '@/components/shell/capture';
import { CAPTURE_ACTIONS, matchCaptureActions } from '@/lib/capture/actions';
import { setTheme } from '@/app/theme-actions';
import { MODULES, type ModuleId } from '@/lib/modules';
import {
  COLOURWAYS,
  colourwayOf,
  formatTheme,
  hueOf,
  modeOf,
  THEME_ROOMS,
  type Theme,
} from '@/lib/theme';
import { applyTheme } from '@/lib/theme/apply';
import type { NavSection } from '@/components/shell/app-shell';

/**
 * What a search box shows, for any search box.
 *
 * Two halves in one list. The places you can go -- workspaces, the sections of
 * the one you are in, the themes, the things you can capture -- and the things
 * you own: a company, a role, an order, something on a shelf, a todo, a note,
 * a reading.
 *
 * They share a list rather than sitting in sections under each other, which
 * was decided on the feature. The argument for one list is that you are
 * looking for a thing rather than for a kind of thing, and two lists make you
 * decide which half your quarry is in before you have found it. What keeps
 * that legible is the mark drawn beside each row: every row carries the
 * workspace it lives in, so "which of these is the shopping one" is answered
 * without a label.
 *
 * The navigation half is synchronous and always right. The data half is a
 * list fetched once when a box becomes active and matched in the browser, so
 * typing costs nothing: it arrives later, cannot arrive at all when a
 * workspace is down, and must never hold the first half up. With no query
 * typed this is exactly what it was before any of it existed.
 *
 * All of it lives here rather than in the command palette because there are
 * two boxes now -- the modal, and the bar across the top of every workspace --
 * and a second copy of the cache, the ranking and the fallback would drift
 * from the first within a step or two. The modal only draws what this returns.
 */

/**
 * Everything findable, whose it is, and whether the server had to cut the list
 * short.
 *
 * `account` is the user id the server returned with the rows. It is what makes
 * a list from the last open usable now: the same account's, or nobody's.
 */
type Held = { account: string; hits: SearchHit[]; truncated: boolean };

/**
 * The list, outside the component.
 *
 * It has to survive a box closing and the page changing -- both unmount
 * whatever is using this -- or every open would start with nothing to match
 * against and the first two keystrokes would find nothing. Outside every
 * component rather than one, so the bar and the modal share the fetch.
 */
let held: Held | null = null;
let inFlight: Promise<void> | null = null;
/** The account whose fetch last finished, which tells a failure from a first open. */
let settledFor: string | null = null;

/**
 * Throw away a list that belongs to somebody else.
 *
 * Signing out is a server action that redirects, and the router does that as a
 * client-side navigation, so nothing here is reloaded -- without this the next
 * person to search in the tab would type at the last person's rows.
 */
function forgetOtherAccounts(account: string): void {
  if (held && held.account !== account) held = null;
  if (settledFor !== null && settledFor !== account) settledFor = null;
}

/**
 * Fetch the whole list, one request at a time.
 *
 * Every open asks again, which is what #489 settled: the list is then never
 * more than one open out of date, and nothing has to keep track of what
 * changed. A failed fetch leaves whatever was already held alone -- a list
 * from a minute ago beats no list at all, and a box falls back to asking the
 * server per keystroke only when it has nothing.
 *
 * The whole account, never one workspace: narrowing happens in the browser
 * over these rows, so one fetch answers a bar set to jobs and the same bar
 * switched to everything.
 */
function loadEverything(account: string): Promise<void> {
  forgetOtherAccounts(account);

  inFlight ??= fetch('/api/search/all')
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { account?: string; hits?: SearchHit[]; truncated?: boolean } | null) => {
      if (body?.hits) {
        held = {
          // Stamped with what the server said the session was, not with what
          // the page thought it was when the request went out.
          account: body.account ?? account,
          hits: body.hits,
          truncated: body.truncated ?? false,
        };
      }
    })
    .catch(() => {
      // The navigation half never depended on this, and the search half has
      // the per-keystroke endpoint to fall back to.
    })
    .finally(() => {
      inFlight = null;
      settledFor = account;
    });

  return inFlight;
}

/**
 * What a box is matching against.
 *
 * `loading` is the first open, before the list has landed. `fallback` is the
 * two cases the held list cannot answer from: the fetch failed, or the cap cut
 * it short, so the rows it holds are not all of them.
 */
type Matching =
  | { status: 'loading' }
  | { status: 'ready'; account: string; hits: SearchHit[] }
  | { status: 'fallback' };

function matchingNow(account: string): Matching {
  if (held && held.account === account && !held.truncated) {
    return { status: 'ready', account, hits: held.hits };
  }
  return settledFor === account ? { status: 'fallback' } : { status: 'loading' };
}

/** A row in the one list: somewhere to go, or something you own. */
export type SearchRow = { kind: 'command'; command: SearchCommand } | { kind: 'hit'; hit: SearchHit };

/**
 * Which of the two search boxes is asking.
 *
 * It only decides what an empty query answers with, and the two answers are
 * opposites, so the hook cannot work it out for itself.
 *
 * `'bar'` is the field across the top of a wide window. It has the cursor
 * because somebody clicked into it or tabbed past it, which is not yet a
 * question, so it offers nothing until a character is typed.
 *
 * `'box'` is the panel the magnifier and the shortcut open. Opening it is the
 * question, so it opens on somewhere to go and something to start.
 *
 * Everything else here is the same for both: once there is a query the two
 * lists are built the same way, from the same rows, in the same order.
 */
export type SearchSurface = 'bar' | 'box';

export type SearchCommand = {
  id: string;
  label: string;
  hint?: string;
  module?: ModuleId | null;
  icon?: 'theme';
  run: () => void;
};

/** Applying a theme from a search box: the document first, the account behind it. */
function applying(next: Theme): SearchCommand['run'] {
  return () => {
    applyTheme(document.documentElement, next);
    void setTheme(formatTheme(next));
  };
}

/**
 * The theme commands, built from what is on screen.
 *
 * A colour is applied to the room you are already in, which is what makes
 * "Theme: Green" one command rather than three: the switch and the swatches are
 * separate choices in the picker and they stay separate here.
 */
function themeCommands(theme: Theme): SearchCommand[] {
  const mode = modeOf(theme);
  const hue = hueOf(theme);
  const way = colourwayOf(theme) ?? undefined;


  return [
    ...THEME_ROOMS.map((option) => ({
      id: `theme:${option.id}`,
      label: `Theme: ${option.label}`,
      hint: 'Keeps the colour you are in',
      icon: 'theme' as const,
      run: applying({ kind: 'generated', mode: option.id, hue, way }),
    })),
    ...COLOURWAYS.map((colour) => ({
      id: `theme:${colour.id}`,
      label: `Theme: ${colour.label}`,
      hint: colour.mood,
      icon: 'theme' as const,
      run: applying({ kind: 'generated', mode, hue: colour.hue, way: colour.id }),
    })),
    {
      id: 'theme:none',
      label: 'Theme: no colour',
      hint: mode === 'light' ? 'Paper' : mode === 'dark' ? 'Ink' : 'Lightbox',
      icon: 'theme' as const,
      run: applying({ kind: 'generated', mode, hue: null }),
    },
    {
      id: 'theme:system',
      label: 'Theme: follow the system',
      icon: 'theme' as const,
      run: applying({ kind: 'system' }),
    },
  ];
}

/** The key a box should draw a row under. Stable across keystrokes. */
export function searchRowKey(row: SearchRow): string {
  return row.kind === 'command' ? row.command.id : `hit:${row.hit.kind}:${row.hit.id}`;
}

export function useSearchRows({
  account,
  module,
  scope,
  sections,
  enabledModules,
  theme,
  query,
  active,
  surface,
}: {
  /** Whose pages these are. The held list is only searched when it is theirs. */
  account: string;
  /** The workspace the page is in, which is what the navigation half is built from. */
  module: ModuleId | null;
  /**
   * The workspace the search is asked for, or everything.
   *
   * Separate from `module` because the bar's chip switches this while the page
   * stays where it is. It narrows both halves of the list: the things you own,
   * and the places you can go and the things you can start. So a search asked
   * for one workspace cannot take you to another, and a search asked for
   * everything is what it has always been.
   */
  scope: SearchScope;
  sections: readonly NavSection[];
  enabledModules?: readonly ModuleId[];
  /** What is on screen now, so a colour can be applied to the mode you are in. */
  theme: Theme;
  /** What has been typed. Trimmed here, so a caller passes the field as it is. */
  query: string;
  /**
   * Whether this box is being used: the modal is open, or the bar has the
   * cursor. Nothing is fetched until it is true.
   */
  active: boolean;
  /** Which box is asking, which is what an empty query is answered from. */
  surface: SearchSurface;
}): {
  rows: SearchRow[];
  /** An answer is still on its way, so "nothing matches" would be premature. */
  looking: boolean;
  /** Go where a row goes, or do what it does. Closing the box is the caller's. */
  run: (row: SearchRow | undefined) => void;
  /** Forget the last fallback answer. A box calls this when it closes. */
  reset: () => void;
} {
  /**
   * The last answer from the per-keystroke endpoint, and which query and scope
   * it answered. Only used when the held list cannot answer.
   *
   * Kept together so both "what to show" and "is something still on its way"
   * are derived rather than stored: an effect that clears state on its way to
   * fetching causes a render for every keystroke, and the rows would blink.
   */
  const [answer, setAnswer] = useState<{
    query: string;
    scope: SearchScope;
    hits: SearchHit[];
  } | null>(null);
  const [matching, setMatching] = useState<Matching>(() => matchingNow(account));
  const router = useRouter();
  const { open: openCapture } = useCapture();

  const commands = useMemo<SearchCommand[]>(() => {
    const visible = MODULES.filter(
      (entry) => enabledModules === undefined || enabledModules.includes(entry.id),
    );

    const all = [
      ...sections.map((section) => ({
        id: `section:${section.href}`,
        label: section.label,
        hint: 'Go to',
        module,
        run: () => router.push(section.href),
      })),
      {
        id: 'workspace:home',
        label: 'Home',
        hint: 'Workspace',
        module: null,
        run: () => router.push('/home'),
      },
      ...visible
        .filter((entry) => entry.id !== module)
        .map((entry) => ({
          id: `workspace:${entry.id}`,
          label: entry.label,
          hint: 'Workspace',
          module: entry.id as ModuleId,
          run: () => router.push(entry.home),
        })),
      {
        id: 'go:account',
        label: 'Account',
        hint: 'Go to',
        module: null,
        run: () => router.push('/account'),
      },
      // The same set the picker offers, one command per control: the two
      // polarities, the five colours applied to whichever polarity you are in,
      // Lightbox, and following the system. A command per combination would be
      // twelve rows of theme in a list you came to for something else.
      ...themeCommands(theme),
    ];

    // Narrowed by the same rule as the things you own, and from the same file.
    // Every row carries the workspace it belongs to, so a scope naming one
    // keeps this workspace's sections and drops every other workspace, Home,
    // Account and the themes, which is the answer on #720. A scope of
    // everything leaves the list as it was.
    return commandsInScope(all, scope);
  }, [sections, module, enabledModules, router, theme, scope]);

  /**
   * The things you can make, when what you typed names one.
   *
   * This is a search box's half of capture: it is the picker, and choosing a
   * row here files nothing at all -- it opens the capture panel with whatever
   * else you typed already in the field, and Enter *there* is what writes the
   * task. So "add todo" and Enter gets you an empty panel to dictate into, and
   * "add todo ring the dentist" gets you one with the todo in it.
   *
   * Ranked against the action's own words rather than the whole query, for the
   * reason in lib/capture/actions.ts, and then sorted in with everything else
   * on the same points, so a workspace called Todo still wins on "todo".
   *
   * Scoped like the rest of the list: a search asked for one workspace offers
   * only what you can start in that workspace.
   */
  const captures = useMemo(
    () =>
      matchCaptureActions(query)
        .filter(({ action }) => moduleInScope(action.module, scope))
        .map(({ action, points, seed }) => ({
          points,
          command: {
            id: `capture:${action.id}`,
            label: action.label,
            hint: seed || 'Capture',
            module: action.module,
            run: () => openCapture(action.id, seed),
          } satisfies SearchCommand,
        })),
    [query, openCapture, scope],
  );

  /**
   * The things you can start here, for a list nobody has typed into.
   *
   * `matchCaptureActions` answers an empty query with nothing, which is right
   * for ranking and leaves the opening list without them. So these rows are
   * built rather than matched, and nothing is seeded into the panel they open,
   * because nothing was typed to seed it with.
   *
   * Only where the search names a workspace. A box opened outside one searches
   * everything, and everything is the list it has always opened with.
   */
  const startable = useMemo<SearchCommand[]>(() => {
    if (scope === 'everything') return [];
    return CAPTURE_ACTIONS.filter((action) => moduleInScope(action.module, scope)).map(
      (action) => ({
        id: `capture:${action.id}`,
        label: action.label,
        hint: 'Capture',
        module: action.module,
        run: () => openCapture(action.id),
      }),
    );
  }, [scope, openCapture]);

  const matches = useMemo(() => {
    if (!query.trim()) {
      // The bar has the cursor because somebody clicked into it or tabbed
      // past it. Neither is a question yet, so it answers with nothing until
      // a character is typed, which is the answer on #717.
      if (surface === 'bar') return [];
      // Opening the box is the question, so it answers: where you can go from
      // here and what you can start here. Both halves are already narrowed to
      // the workspace by the scope, so a box opened in one offers no other
      // workspace, no Home, no Account and no theme -- #737. The cap is the
      // same eight the list is capped at once there is a query.
      return [...commands, ...startable].slice(0, 8);
    }
    return [
      ...captures,
      ...commands
        .map((command) => ({
          command,
          points: score(`${command.label} ${command.hint ?? ''}`, query.trim()),
        }))
        .filter(
          (entry): entry is { command: SearchCommand; points: number } => entry.points !== null,
        ),
    ]
      .sort((a, b) => b.points - a.points)
      .slice(0, 8)
      .map((entry) => entry.command);
  }, [captures, commands, query, startable, surface]);

  const needle = query.trim();
  const searching = active && needle.length >= MIN_QUERY;

  /**
   * Fetch the list when a box becomes active.
   *
   * One request per open and none per keystroke, which is the whole of the
   * change: whatever was held from last time is still what is matched against
   * until the new answer lands, so the first two characters find something
   * while it is still in flight.
   */
  useEffect(() => {
    if (!active) return;

    let alive = true;
    void loadEverything(account).then(() => {
      if (alive) setMatching(matchingNow(account));
    });

    return () => {
      alive = false;
    };
  }, [active, account]);

  /**
   * Drop everything the moment the account on screen changes.
   *
   * Signing out and in again in the same tab does not reload the page, so the
   * list from before the sign-out is still in memory and the last answer from
   * the per-keystroke endpoint is still in state. Neither belongs to whoever
   * is signed in now.
   */
  const shownFor = useRef(account);
  useEffect(() => {
    if (shownFor.current === account) return;
    shownFor.current = account;
    forgetOtherAccounts(account);
    setAnswer(null);
    setMatching(matchingNow(account));
  }, [account]);

  /**
   * The rows, ranked here rather than by the server.
   *
   * The same file the server ranks with, so a company cannot sort one way in
   * the held list and another in a fallback answer. Nothing is fetched: this
   * runs over what the browser already holds, on every keystroke.
   *
   * Narrowed before it is ranked. The caps in rank.ts are six per workspace
   * and twelve overall, so ranking the whole account first would spend them on
   * rows the scope is about to drop.
   */
  const hits = useMemo<SearchHit[]>(() => {
    if (!searching) return [];
    // The account is checked here as well as in matchingNow: this is state, and
    // state from before an account change outlives the render that changed it.
    if (matching.status === 'ready' && matching.account === account) {
      return paletteHits(hitsInScope(matching.hits, scope), needle);
    }
    // Stale rows stay on screen while a newer answer is on its way: clearing
    // them first would make the list jump on every keystroke, and a list that
    // moves under the cursor is worse than one that is briefly behind.
    if (matching.status === 'fallback') return answer?.hits ?? [];
    return [];
  }, [searching, matching, needle, answer, account, scope]);

  const asking = searching && matching.status === 'fallback';
  const answered = answer?.query === needle && answer.scope === scope;
  const looking = searching && (matching.status === 'loading' || (asking && !answered));

  /**
   * Ask per keystroke, when the held list cannot answer.
   *
   * The fetch failed, or the cap cut the list short and the rows in the
   * browser are not all of them. Debounced, and every request aborts the one
   * before it -- which is why the endpoint is a route handler rather than a
   * server action. Without the abort, a slow answer to "ac" lands after the
   * answer to "acme" and replaces it with staler results, which is the one bug
   * that makes a search box feel broken rather than slow.
   *
   * The scope goes with the query, so the server runs only the sources in it.
   */
  useEffect(() => {
    if (!asking) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const url = `/api/search?q=${encodeURIComponent(needle)}&${SCOPE_PARAM}=${encodeURIComponent(scope)}`;
      fetch(url, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { hits: [] }))
        .then((body: { hits?: SearchHit[] }) =>
          setAnswer({ query: needle, scope, hits: body.hits ?? [] }),
        )
        .catch(() => {
          // An aborted request is the normal case rather than a failure: the
          // next keystroke cancelled it. Either way the box keeps working,
          // because the navigation half never depended on this.
        });
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needle, asking, scope]);

  /**
   * One list. Commands first, then the things you own.
   *
   * The commands are already ranked against the query by the same scorer the
   * hits are ranked with, so the two halves are ordered on the same terms;
   * putting the navigation half first is the tie-break, because it is the half
   * that is always right and always instant.
   */
  const rows = useMemo<SearchRow[]>(
    () => [
      ...matches.map((command) => ({ kind: 'command' as const, command })),
      ...hits.map((hit) => ({ kind: 'hit' as const, hit })),
    ],
    [matches, hits],
  );

  const run = useCallback(
    (row: SearchRow | undefined) => {
      if (!row) return;
      if (row.kind === 'command') row.command.run();
      else router.push(row.hit.href);
    },
    [router],
  );

  const reset = useCallback(() => setAnswer(null), []);

  return { rows, looking, run, reset };
}
