/**
 * The quick actions capture can file, in one list.
 *
 * ⌘K goes anywhere and finds anything; this is the other half -- the small set
 * of things you can *make* without leaving the page you are on. It is a
 * registry rather than a hard-coded panel because the answer to "what is a
 * note, when the app never writes to the vault" was to build the framework
 * first and leave note creation, and whatever comes after it, a row in this
 * list rather than a second surface.
 *
 * So an action is what the panel needs to know to take dictation: what it is
 * called, whose workspace the result belongs to (the mark beside it), what the
 * empty field should say, what shape the field is, and the words that should
 * find it in the palette. What it does *not* carry is a writer -- filing is
 * the module's own server action, wired where the panel is used, so nothing in
 * this file can become a second way to write a task.
 */

import { score } from '@/lib/search/score';
import type { ModuleId } from '@/lib/modules';
import type { CapturePlace, CaptureSortRole } from '@/lib/capture/sort';

export type CaptureActionId = 'anything' | 'todo' | 'goals' | 'vault';

export type CaptureAction = {
  id: CaptureActionId;
  /** The panel's title, and the palette row that opens it. */
  label: string;
  /**
   * Where what you write ends up. Null would mean "belongs to no workspace",
   * which the mark draws as the home key -- honest for an action that files
   * into the account rather than into a module.
   */
  module: ModuleId | null;
  /** The field before anything is typed. */
  placeholder: string;
  /**
   * A line or a paragraph. A todo is a title, and a single line keeps Enter
   * unambiguous; a note is prose and will want the other one, which is the
   * whole reason this is a field on the action rather than a fact about the
   * panel.
   */
  field: 'line' | 'prose';
  /**
   * Whether what you file can be given a day. True for a todo, where "today"
   * and "tomorrow" are most of what anyone ever answers "when" with; false
   * for anything that is not due -- a note is written, not scheduled -- and
   * the panel draws the day chips only where it is true, so an action that
   * has no use for a date does not get two controls that do nothing.
   */
  dated: boolean;
  /**
   * What should find it, beyond its own label: "add todo" and "new task" are
   * both what somebody types when they mean this one.
   */
  keywords: readonly string[];
};

export const CAPTURE_ACTIONS: readonly CaptureAction[] = [
  {
    // One box for whatever you type: Dash reads it and files it as a todo, a
    // goal update or a note on a job (plan #1581, feature #1579). No module,
    // because it files into whichever workspace the sentence belongs in, so
    // its mark is the home key.
    id: 'anything',
    label: 'Capture anything',
    module: null,
    placeholder: 'Type anything. Dash files it where it belongs.',
    field: 'prose',
    dated: false,
    keywords: ['capture', 'jot', 'write down', 'file', 'note'],
  },
  {
    id: 'todo',
    label: 'Add a todo',
    module: 'todo',
    placeholder: 'What needs doing?',
    field: 'line',
    dated: true,
    keywords: ['add todo', 'new todo', 'add task', 'new task', 'capture'],
  },
  {
    // What happened, filed against your goals by a model call (plan #929).
    // Prose, because "went to the talk, met someone, want to volunteer" is a
    // sentence and not a title.
    id: 'goals',
    label: 'Log what happened',
    module: 'goals',
    placeholder: 'What happened? It is filed against your goals.',
    field: 'prose',
    dated: false,
    keywords: ['log', 'what happened', 'log progress', 'goal progress', 'capture goal'],
  },
  {
    // A quick note in the vault's Inbox, the one the Vault page's Add a quick
    // note writes (note 4a7935d3), so it can be set down from any page and
    // sorted later in Quick note triage. Dash chooses nothing for it.
    id: 'vault',
    label: 'Add a quick note',
    module: 'vault',
    placeholder: 'Whatever is on your mind. It waits in Quick note triage.',
    field: 'prose',
    dated: false,
    keywords: ['quick note', 'vault note', 'new note', 'inbox', 'capture note'],
  },
];

/**
 * The actions an account can use: those whose workspace it has, plus any that
 * belong to none. Filing into Goals for an account without Goals would write
 * rows it cannot see.
 */
export function availableCaptureActions(
  modules: readonly ModuleId[] | undefined,
): readonly CaptureAction[] {
  if (!modules) return CAPTURE_ACTIONS;
  return CAPTURE_ACTIONS.filter((action) => action.module === null || modules.includes(action.module));
}

/**
 * What the shortcut and the header control open when nothing else is named:
 * the one box, so nothing has to be chosen before typing (plan #1581). Add a
 * todo and Log what happened stay in the palette and the panel's header for
 * when you want to pick.
 */
export const DEFAULT_CAPTURE_ACTION: CaptureActionId = 'anything';

export function captureAction(id: string): CaptureAction | null {
  return CAPTURE_ACTIONS.find((action) => action.id === id) ?? null;
}

/**
 * What a typed query is ranked against, for `lib/search/score`. Label and
 * keywords in one string so "add todo" and "task" both reach the same row,
 * ranked by the same scorer the palette ranks everything else with.
 */
export function captureHaystack(action: CaptureAction): string {
  return `${action.label} ${action.keywords.join(' ')}`;
}

/** An action a typed query names, and the words it did not use up. */
export type CaptureMatch = {
  action: CaptureAction;
  /** Ranked by the scorer the palette ranks everything else with. */
  points: number;
  /** What is left of the query: the thing to file, rather than its name. */
  seed: string;
};

/**
 * Which actions a query in the palette names, best first.
 *
 * Scored against the leading words rather than against the whole query,
 * because everything after the name is the thing being filed: "add todo ring
 * the dentist" names the action in two words and hands the panel the rest.
 * Scoring the whole string instead would lose the row on the first word of
 * the todo itself, since a subsequence match is exactly what the rest of a
 * sentence fails.
 *
 * The longest leading run that still names the action wins, so the seed is
 * what is genuinely left over rather than the first word that happened to
 * match. An empty query names nothing: the palette with nothing typed in it
 * is a list of places to go, and it stays one.
 */
export function matchCaptureActions(
  query: string,
  actions: readonly CaptureAction[] = CAPTURE_ACTIONS,
): CaptureMatch[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const matches: CaptureMatch[] = [];
  for (const action of actions) {
    const haystack = captureHaystack(action);
    for (let take = words.length; take > 0; take -= 1) {
      const points = score(haystack, words.slice(0, take).join(' '));
      if (points === null) continue;
      matches.push({ action, points, seed: words.slice(take).join(' ') });
      break;
    }
  }

  return matches.sort((a, b) => b.points - a.points);
}

// ---------------------------------------------------------------------------
// Kinds: what an Add button aims capture at (plan #1950.1)
// ---------------------------------------------------------------------------

/**
 * The things capture can make, one per kind of row. An Add button on a list
 * opens capture aimed at its list's kind: the sort is skipped, the panel asks
 * for the kind's title and at most one more thing, and one press makes the
 * row (docs/ONE-INTERFACE-SPEC.md, Part 3). Untargeted text from the header
 * and ⌥C still goes through Dash's sort, which files each part as one of
 * these kinds.
 *
 * The writer for each kind is in lib/capture/file.ts (CAPTURE_MAKERS), keyed
 * by the same ids, so this file stays free of server code and the panel can
 * import it.
 */
export type CaptureKindId =
  | 'todo'
  | 'goal-update'
  | 'job-note'
  | 'vault-note'
  // Goals and Dev (plan #1950.5): never chosen by the sort, only aimed.
  | 'goal'
  | 'goal-area'
  | 'plan-feature'
  | 'plan-step'
  | 'idea'
  | 'dev-note'
  | 'order'
  | 'inventory-item'
  | 'saved-item'
  // Jobs and Learn (plan #1950.4)
  | 'job-role'
  | 'learn-reading'
  | 'learn-topic'
  | 'learn-quiz'
  // Learn (plan #1950.6): one thing to read, on the track the page is open on.
  | 'track-reading';

/**
 * The one thing a kind may need besides its title. A todo takes a day; a
 * note on a job takes the role, which the page aiming it already knows. A
 * goal takes its area and a plan step the row it goes under (`under`).
 */
export type CaptureKindNeeds = 'day' | 'role' | 'under' | null;

/**
 * The row a new one goes under, or the plan module a new feature goes in:
 * its id and the name the panel shows ("In Health").
 */
export type CaptureUnder = { id: string; title: string };

export type CaptureKind = {
  id: CaptureKindId;
  /**
   * The place Dash's sort files this kind as, or null for a kind only an Add
   * button makes, which the sort never files into.
   */
  place: CapturePlace | null;
  /** Whose workspace the row belongs to. */
  module: ModuleId;
  /** The panel's title when aimed: "Add a todo". */
  label: string;
  /** The title field before anything is typed. */
  placeholder: string;
  field: 'line' | 'prose';
  needs: CaptureKindNeeds;
  /**
   * What one press makes. `row`: one row, whose page then opens. `filing`: a
   * sentence Dash files against several rows (a goal update), which keeps
   * its own panel and its Undo on each line, so aiming it opens that panel.
   */
  makes: 'row' | 'filing';
  /** The nav row the chip flies to once the row is made. */
  section: string;
  /** The panel action that takes this kind unaimed, from the palette. */
  action: CaptureActionId;
  /**
   * Made by any account, whatever its workspaces: a note for Dev is how
   * anyone reports a bug, though only the owner has the Dev workspace.
   */
  everyone?: boolean;
  /** Takes files with it, as the header's note did (plan #1713). */
  files?: boolean;
  /**
   * The camera step inside the panel (plan #1950.3.2), in place of typing:
   * a receipt photo the order is read from, or a barcode naming the book or
   * game to add. Typing still works beside it.
   */
  camera?: 'receipt' | 'barcode';
};

/**
 * What a scanned barcode named (plan #1950.3.2): a book or a game, with the
 * catalog's record as JSON, which the press saves as it is so the add does
 * not look the code up a second time. The server checks the record against
 * the book or game schema before writing it.
 */
export type ScannedThing = {
  kind: 'book' | 'game';
  title: string;
  /** The authors, or the year and publisher: the line under the title. */
  byline: string | null;
  /** The cover or the box, where the catalog has one. */
  image: string | null;
  code: string;
  record: string;
};

export const CAPTURE_KINDS: Readonly<Record<CaptureKindId, CaptureKind>> = {
  todo: {
    id: 'todo',
    place: 'todo',
    module: 'todo',
    label: 'Add a todo',
    placeholder: 'What needs doing?',
    field: 'line',
    needs: 'day',
    makes: 'row',
    section: '/todo',
    action: 'todo',
  },
  'goal-update': {
    id: 'goal-update',
    place: 'goals',
    module: 'goals',
    label: 'Log what happened',
    placeholder: 'What happened? It is filed against your goals.',
    field: 'prose',
    needs: null,
    makes: 'filing',
    section: '/goals',
    action: 'goals',
  },
  'job-note': {
    id: 'job-note',
    place: 'jobs',
    module: 'jobs',
    label: 'Add a note',
    placeholder: 'What happened, or what to remember about this role?',
    field: 'prose',
    needs: 'role',
    makes: 'row',
    section: '/jobs',
    // No panel action of its own: from the palette a note on a job goes
    // through the sort, which names the role.
    action: 'anything',
  },
  'vault-note': {
    id: 'vault-note',
    place: 'vault',
    module: 'vault',
    label: 'Add a quick note',
    placeholder: 'Whatever is on your mind. It waits in the Inbox.',
    field: 'prose',
    needs: null,
    makes: 'row',
    section: '/vault',
    action: 'vault',
  },
  goal: {
    id: 'goal',
    place: null,
    module: 'goals',
    label: 'Add a goal',
    placeholder: 'An outcome that ends, such as pay off the credit cards',
    field: 'line',
    needs: 'under',
    makes: 'row',
    section: '/goals',
    action: 'anything',
  },
  'goal-area': {
    id: 'goal-area',
    place: null,
    module: 'goals',
    label: 'Add an area',
    placeholder: 'A direction that never finishes, such as Career or The city',
    field: 'line',
    needs: null,
    makes: 'row',
    section: '/goals',
    action: 'anything',
  },
  'plan-feature': {
    id: 'plan-feature',
    place: null,
    module: 'dev',
    label: 'Add a feature',
    placeholder: 'Feature name',
    field: 'line',
    // `under` names the module when the page knows it; without it the
    // feature is for the app as a whole.
    needs: null,
    makes: 'row',
    section: '/dev',
    action: 'anything',
  },
  'plan-step': {
    id: 'plan-step',
    place: null,
    module: 'dev',
    label: 'Add a step',
    placeholder: 'What the step does',
    field: 'line',
    needs: 'under',
    makes: 'row',
    section: '/dev',
    action: 'anything',
  },
  idea: {
    id: 'idea',
    place: null,
    module: 'dev',
    label: 'Add an idea',
    placeholder: 'Something worth doing one day. It waits on the ideas page.',
    field: 'prose',
    needs: null,
    makes: 'row',
    section: '/dev',
    action: 'anything',
  },
  'dev-note': {
    id: 'dev-note',
    place: null,
    module: 'dev',
    label: 'Report a bug or ask for a change',
    placeholder: 'What went wrong, or what it should do.',
    field: 'prose',
    // The page it was filed from rides on the aim when there is one; a note
    // filed on the queue itself has none worth saving.
    needs: null,
    makes: 'row',
    section: '/dev',
    action: 'anything',
    everyone: true,
    files: true,
  },
  // Shopping's three lists (plan #1950.3.1). The sort never files these, so
  // they have no place and no panel action of their own.
  order: {
    id: 'order',
    place: null,
    module: 'shopping',
    label: 'Add an order',
    placeholder: 'What did you buy, where, and what did it cost?',
    field: 'prose',
    needs: null,
    makes: 'row',
    section: '/shopping/orders',
    action: 'anything',
    camera: 'receipt',
  },
  'inventory-item': {
    id: 'inventory-item',
    place: null,
    module: 'shopping',
    label: 'Add something you own',
    placeholder: 'Its name, or the ISBN of a book',
    field: 'line',
    needs: null,
    makes: 'row',
    section: '/shopping/inventory',
    action: 'anything',
    camera: 'barcode',
  },
  'saved-item': {
    id: 'saved-item',
    place: null,
    module: 'shopping',
    label: 'Save a link',
    placeholder: 'Paste the link to the thing',
    field: 'line',
    needs: null,
    makes: 'row',
    section: '/shopping/saved',
    action: 'anything',
  },
  // Jobs and Learn (plan #1950.4): made only from an Add button, so no place.
  'job-role': {
    id: 'job-role',
    place: null,
    module: 'jobs',
    label: 'Add a role',
    placeholder: 'Paste the posting link, or write the role at the company',
    field: 'line',
    needs: null,
    makes: 'row',
    section: '/jobs',
    action: 'anything',
  },
  'learn-reading': {
    id: 'learn-reading',
    place: null,
    module: 'learn',
    label: 'Save a reading',
    placeholder: 'Paste a link to read later',
    field: 'line',
    needs: null,
    makes: 'row',
    section: '/learn',
    action: 'anything',
  },
  'track-reading': {
    id: 'track-reading',
    place: null,
    module: 'learn',
    label: 'Add something to read',
    placeholder: 'Something specific you want to learn',
    field: 'line',
    needs: 'under',
    makes: 'row',
    section: '/learn',
    action: 'anything',
  },
  'learn-topic': {
    id: 'learn-topic',
    place: null,
    module: 'learn',
    label: 'Start a topic',
    placeholder: 'What you want to learn about. Paste a reading list on the lines below it.',
    field: 'prose',
    needs: null,
    makes: 'row',
    section: '/learn',
    action: 'anything',
  },
  'learn-quiz': {
    id: 'learn-quiz',
    place: null,
    module: 'learn',
    label: 'Start a quiz',
    placeholder: 'Paste what to be quizzed on, or name notes as [[Note title]]',
    field: 'prose',
    needs: null,
    makes: 'row',
    section: '/learn',
    action: 'anything',
  },
};

/** The kind Dash's sort files a part as, by its place. */
export function kindForPlace(place: CapturePlace): CaptureKind {
  const kind = Object.values(CAPTURE_KINDS).find((k) => k.place === place);
  if (!kind) throw new Error(`No capture kind files into ${place}.`);
  return kind;
}

/**
 * What an Add button hands capture: the kind, and the one more thing when
 * the page already knows it (the role a note is on). `seed` starts the title.
 */
export type CaptureAim = {
  kind: CaptureKindId;
  role?: CaptureSortRole;
  /** The area a goal goes in, the row a step goes under, or a feature's module. */
  under?: CaptureUnder;
  /** The page a note for Dev was filed from. */
  page?: string;
  seed?: string;
};

/**
 * Why an aim cannot be made as it stands, or null when it can. A kind that
 * needs a role has to be handed one: a note aimed at no role would be filed
 * nowhere, so the panel says so instead.
 */
export function aimProblem(aim: CaptureAim): string | null {
  const kind = CAPTURE_KINDS[aim.kind];
  if (!kind) return 'Capture cannot make that.';
  if (kind.needs === 'role' && !aim.role) return 'Open the role first, then add the note there.';
  if (kind.needs === 'under' && !aim.under) return 'Open the place it goes under first, then add it there.';
  return null;
}
