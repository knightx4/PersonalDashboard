/**
 * Which gallery surfaces a change to the app's screens should be looked at in.
 *
 * Part 1 of docs/UI-QUALITY-SPEC.md: a step that changes a screen draws it in
 * the gallery and photographs it before the code is wired up, and its brief
 * names the surfaces to photograph. That needs each surface to say which pages
 * it stands for, and something to turn a list of changed files into the pages
 * they serve. Both are here.
 *
 * The routes live in this file rather than on each entry in
 * app/preview/surfaces.tsx because the brief is written in three places (the
 * plan CLI, the plan page's server actions and the routine hand-over) and
 * none of them should load the gallery, which imports half the app's
 * components. `tests/preview-routes.test.ts` holds the two lists together: a
 * surface added to the gallery without routes here fails it, and so does a
 * route here for a surface that is gone.
 *
 * Pure. Following imports from a changed component to the pages that use it
 * needs the file system, and is lib/preview/importers.ts.
 */

/**
 * The pages each gallery surface stands for, as the app's own route patterns
 * (`/jobs/roles/[id]`, with the route groups taken out).
 *
 * A surface drawn from a demo on /dev/ui names the page the demo is of, not
 * /dev/ui. The shell surfaces name Home, the page where the shell is seen
 * first; a change to the shell itself reaches them through the root layout.
 */
export const SURFACE_ROUTES: Readonly<Record<string, readonly string[]>> = {
  'jobs-role-timeline': ['/jobs/roles/[id]'],
  'jobs-role-posting': ['/jobs/roles/[id]'],
  'jobs-role-answers': ['/jobs/roles/[id]'],
  'jobs-role-interviews': ['/jobs/roles/[id]'],
  'jobs-pipeline-board': ['/jobs/pipeline'],
  'jobs-moment-forward': ['/jobs/pipeline'],
  'jobs-moment-offer': ['/jobs/pipeline'],
  'jobs-moment-reject': ['/jobs/pipeline'],
  'jobs-pipeline-focus': ['/jobs/pipeline'],
  'shopping-item-details': ['/shopping/inventory/[id]'],
  'dev-comment-thread': ['/dev/plan'],
  'dev-comment-thread-empty': ['/dev/plan'],
  'dev-comment-thread-composer': ['/dev/plan'],
  'dev-plan-tree': ['/dev/plan'],
  'dev-plan-table': ['/dev/plan'],
  'dev-plan-opened': ['/dev/plan'],
  'dev-plan-critic-stop': ['/dev/plan'],
  'dev-plan-screen-change': ['/dev/plan'],
  'dev-plan-send-back': ['/dev/plan'],
  'dev-plan-feature': ['/dev/plan/[number]'],
  'dev-plan-feature-steps': ['/dev/plan/[number]'],
  'dev-plan-feature-activity': ['/dev/plan/[number]'],
  'dev-plan-feature-steps-yours': ['/dev/plan/[number]'],
  'dev-plan-feature-edit': ['/dev/plan/[number]'],
  'dev-plan-new-feature': ['/dev/plan', '/dev/projects/[id]'],
  'goals-steps-tree': ['/goals/[goalId]'],
  'goals-steps-opened': ['/goals/[goalId]'],
  'goals-step': ['/goals/[goalId]/s/[stepId]'],
  'goals-substep': ['/goals/[goalId]/s/[stepId]'],
  'goals-step-close': ['/goals/[goalId]/s/[stepId]'],
  'goals-step-arrival': ['/goals/[goalId]/s/[stepId]'],
  'goals-home': ['/goals'],
  'goals-all': ['/goals/all'],
  'goals-area': ['/goals/area/[areaId]'],
  'goals-page-top': ['/goals/[goalId]'],
  'goals-file': ['/goals/files/[fileId]'],
  'goals-page-bare': ['/goals/[goalId]'],
  'goals-page-linking': ['/goals/[goalId]'],
  'goals-info-one': ['/goals/[goalId]'],
  'goals-info-list': ['/goals/[goalId]'],
  'goals-info-list-open': ['/goals/[goalId]'],
  'dev-ui': ['/dev/ui'],
  'dev-ui-corrections': ['/dev/ui'],
  'dev-ui-taste': ['/dev/ui'],
  'dev-surfaces': ['/dev/surfaces'],
  'dev-surfaces-changed': ['/dev/surfaces'],
  'jobs-pipeline-dense': ['/jobs/pipeline'],
  'jobs-company': ['/jobs/companies/[slug]'],
  'jobs-company-add-person': ['/jobs/companies/[slug]'],
  'jobs-review': ['/jobs/review'],
  'jobs-settings': ['/jobs/settings'],
  'jobs-contacts': ['/jobs/contacts'],
  'jobs-contact': ['/jobs/contacts/[id]'],
  'jobs-role-new': ['/jobs/roles/new'],
  'jobs-find': ['/jobs/find'],
  'jobs-recommended-roles': ['/jobs/find'],
  'jobs-roles-table': ['/jobs/pipeline'],
  'jobs-today': ['/jobs'],
  'jobs-insights': ['/jobs/analytics'],
  'todo-calendar-month': ['/todo/calendar'],
  'todo-feed-event': ['/todo/calendar'],
  'vault-note': ['/vault/n/[...path]'],
  'vault-note-edit': ['/vault/n/[...path]'],
  'vault-note-editing': ['/vault/n/[...path]'],
  'vault-note-attachments': ['/vault/n/[...path]'],
  'vault-education-empty': ['/vault/education'],
  'vault-education-upload': ['/vault/education'],
  'vault-education-check': ['/vault/education'],
  'vault-education-list': ['/vault/education'],
  'learn-track-readings': ['/learn/t/[id]'],
  'learn-now-deck': ['/learn/now'],
  'learn-courses-empty': ['/learn/know'],
  'learn-courses-list': ['/learn/know'],
  'learn-course-check': ['/learn/know'],
  'learn-goals-list': ['/goals/[goalId]', '/learn/goals'],
  'learn-flow-scope': ['/learn/flow'],
  'learn-subject-chain': ['/learn/s/[id]'],
  'jobs-interviews': ['/jobs/interviews'],
  'shell-display-options': [
    '/jobs/pipeline',
    '/jobs/companies',
    '/shopping/orders',
    '/shopping/inventory',
  ],
  'shell-search-bar': ['/home'],
  'shell-capture': ['/home'],
  'ask-dash-new': ['/ask', '/ask/[ref]'],
  'ask-dash-answer': ['/ask', '/ask/[ref]'],
  'ask-dash-failed': ['/ask', '/ask/[ref]'],
  'ask-dash-page': ['/goals', '/ask'],
  'ask-dash-proposal': ['/ask', '/ask/[ref]'],
  'ask-dash-changes': ['/ask', '/ask/[ref]'],
  'ask-made-changes': ['/ask', '/ask/[ref]'],
  'learn-clips': ['/learn/clips'],
  'learn-clips-empty': ['/learn/clips'],
  'learn-personality-test': ['/learn/know/personality'],
  'learn-personality-scores': ['/learn/know/personality'],
  'learn-personality-add-type': ['/learn/know/personality'],
  'learn-know-personality': ['/learn/know'],
  'learn-know-personality-reading': ['/learn/know'],
  'learn-know-personality-empty': ['/learn/know'],
  'dev-inspiration': ['/dev/inspiration'],
  'dev-inspiration-list': ['/dev/inspiration'],
  'dev-inspiration-unread': ['/dev/inspiration'],
  'dev-posts': ['/dev/posts'],
  'dev-posts-drafting': ['/dev/posts'],
  'home-watching': ['/home'],
  'home-dash-today': ['/home'],
  'timeline-page': ['/timeline'],
  'timeline-year': ['/timeline/year/[year]'],
  'shell-full': ['/home'],
  'news-issue-digest': ['/news/i/[id]'],
  'news-issue-digest-no-pictures': ['/news/i/[id]'],
  'news-issue-essay': ['/news/i/[id]'],
  'news-issue-original': ['/news/i/[id]'],
  'news-issue-failed': ['/news/i/[id]'],
  'news-quick-story': ['/news'],
  'news-quick-in-shell': ['/news'],
  'news-quick-essay': ['/news'],
  'news-quick-page': ['/news'],
  'news-quick-page-full': ['/news'],
  'news-quick-caught-up': ['/news'],
  'news-story-grid': ['/news/i/[id]', '/news'],
  'news-story-grid-no-pictures': ['/news/i/[id]', '/news'],
  'shopping-recurring': ['/shopping/recurring'],
  'shopping-recurring-empty': ['/shopping/recurring'],
  'news-saved': ['/news/saved'],
  'news-saved-empty': ['/news/saved'],
  'news-review': ['/news/review'],
  'news-review-empty': ['/news/review'],
  'news-review-failed': ['/news/review'],
  'core-cost-hint': ['/shopping/sell', '/shopping/review', '/account/spend'],
  'core-spend-estimates': ['/account/spend'],
  'dev-motion-travel': ['/dev/ui'],
  'dev-motion-settle': ['/dev/ui'],
  'dev-motion-clear': ['/dev/ui'],
  'todo-day-close': ['/todo'],
  'todo-day-closed': ['/todo'],
  'news-quick-got-through': ['/news'],
  'news-quick-got-through-loaded': ['/news'],
  'home-arrival': ['/home'],
  'home-finished-day': ['/home'],
  'home-finished-day-rest': ['/home'],
  'anatomy-list': ['/dev/ui'],
  'anatomy-detail': ['/dev/ui'],
  'anatomy-dashboard': ['/dev/ui'],
  'anatomy-settings': ['/dev/ui'],
  'anatomy-compose': ['/dev/ui'],
  'pattern-list': ['/dev/ui'],
  'pattern-detail': ['/dev/ui'],
  'pattern-deck': ['/dev/ui'],
  'pattern-thread': ['/dev/ui'],
  'pattern-tabbed': ['/dev/ui'],
  'pattern-rail': ['/dev/ui'],
  'front-door': ['/'],
  'auth-login': ['/login'],
  'auth-signup': ['/signup'],
  'auth-reset-password': ['/reset-password'],
  'auth-code-error': ['/auth/auth-code-error'],
  'auth-consent': ['/oauth/consent'],
  'legal-privacy': ['/privacy'],
  'legal-terms': ['/terms'],
  'onboarding-welcome': ['/onboarding'],
  'onboarding-gmail': ['/onboarding'],
  'share-form': ['/s/[token]'],
  'open-missing': ['/open/[ref]'],
  'account': ['/account'],
  'home-week': ['/home/week', '/home/week/[week]'],
  'home-week-none': ['/home/week', '/home/week/[week]'],
  'dev-bugs': ['/dev/bugs'],
  'dev-changelog': ['/dev/changelog'],
  'dev-changelog-screens': ['/dev/changelog'],
  'dev-ideas': ['/dev/ideas'],
  'dev-project-plan': ['/dev/projects/[id]'],
  'dev-raised': ['/dev/raised'],
  'dev-raised-status': ['/dev/raised'],
  'dev-specs': ['/dev/specs'],
  'dev-specs-interview-empty': ['/dev/specs'],
  'dev-specs-interview-half': ['/dev/specs'],
  'dev-specs-interview-drafted': ['/dev/specs'],
  'dev-spec': ['/dev/specs/[slug]'],
  'dev-ui-review': ['/dev/ui/review'],
  'dev-usage': ['/dev/usage'],
};

/** A route split into its segments; `/` is no segments. */
function segmentsOf(route: string): string[] {
  return route.split('/').filter(Boolean);
}

/** Whether one route segment can stand for another: `[id]` stands for any. */
function segmentMatches(a: string, b: string): boolean {
  return a === b || a.startsWith('[') || b.startsWith('[');
}

/**
 * Whether a surface's route is `route`, or, with `under`, any page beneath it.
 * Either side may hold a pattern (`/jobs/roles/[id]`) or a real path
 * (`/jobs/roles/42`); a catch-all (`[...path]`) takes the rest of the path.
 */
export function routeMatches(surfaceRoute: string, route: string, under = false): boolean {
  const s = segmentsOf(surfaceRoute);
  const r = segmentsOf(route);
  for (let i = 0; i < r.length; i++) {
    if (i >= s.length) return false;
    if (s[i].startsWith('[...') || r[i].startsWith('[...')) return true;
    if (!segmentMatches(s[i], r[i])) return false;
  }
  return s.length === r.length || under;
}

/** The surfaces standing for `route`, or for any page beneath it with `under`. */
export function surfacesForRoute(route: string, under = false): string[] {
  return Object.entries(SURFACE_ROUTES)
    .filter(([, routes]) => routes.some((r) => routeMatches(r, route, under)))
    .map(([id]) => id);
}

/** Files a route can hold that frame every page beneath them. */
const FRAMES = new Set(['layout', 'template', 'loading', 'error', 'not-found']);

/**
 * The page a file under `app/` belongs to, as a route, or null for a file
 * that is not under `app/`, an API route or the gallery itself.
 *
 * Route groups (`(app)`) and parallel slots (`@modal`) are not in the URL. A
 * private folder (`_home`) is not routable, so its files belong to the page
 * of the folder that holds it.
 */
export function routeOfFile(file: string): string | null {
  const path = file.replace(/^\.\//, '');
  if (!path.startsWith('app/')) return null;
  const parts = path.split('/').slice(1, -1);
  const kept: string[] = [];
  for (const part of parts) {
    if (part.startsWith('_')) break;
    if (part.startsWith('(') || part.startsWith('@')) continue;
    kept.push(part);
  }
  if (kept[0] === 'api' || kept[0] === 'preview') return null;
  return `/${kept.join('/')}`;
}

/** The file's name without its folder or extension: `page`, `layout`, `panels`. */
function baseName(file: string): string {
  return (file.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
}

/**
 * The surfaces one file under `app/` serves.
 *
 * A page serves its own route. A layout, loading or error file frames every
 * page beneath it. Any other file is taken to serve the page of its folder;
 * when that folder is not a page of its own (`app/news/quick/`), the search
 * moves up a folder at a time until a surface answers, stopping short of `/`
 * so that a stray file does not claim the whole gallery.
 */
function surfacesForAppFile(file: string): string[] {
  const route = routeOfFile(file);
  if (route === null) return [];
  const base = baseName(file);
  if (base === 'page' || base === 'route') return surfacesForRoute(route);
  if (FRAMES.has(base)) return surfacesForRoute(route, true);

  const segments = segmentsOf(route);
  for (let n = segments.length; n >= (segments.length === 0 ? 0 : 1); n--) {
    const found = surfacesForRoute(`/${segments.slice(0, n).join('/')}`);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * The gallery surfaces a list of changed files serves, by route, in gallery
 * order.
 *
 * Only `.tsx` files count: a screen is drawn in one, and a loader or a query
 * changes what a page shows without changing how it looks. A file outside
 * `app/` (a component under `components/`) reaches its pages through the
 * files that import it, which `importers` supplies when the caller can read
 * the file system (lib/preview/importers.ts); without it such a file serves
 * nothing.
 */
export function surfacesForFiles(
  files: readonly string[],
  importers?: (file: string) => readonly string[],
): string[] {
  const found = new Set<string>();
  for (const file of files) {
    const path = file.replace(/^\.\//, '');
    // The gallery's own files draw surfaces rather than serve a page; the
    // pages that import them (/dev/surfaces) are not what changed.
    if (!path.endsWith('.tsx') || path.startsWith('app/preview/')) continue;
    const reached = path.startsWith('app/') ? [path] : [];
    if (importers) reached.push(...importers(path));
    for (const appFile of reached) for (const id of surfacesForAppFile(appFile)) found.add(id);
  }
  return Object.keys(SURFACE_ROUTES).filter((id) => found.has(id));
}

/**
 * The surfaces a piece of writing names: a gallery link (`/preview?s=…`),
 * a page's address (`/news/saved`, `/jobs/roles/42`) or a screen file
 * (`app/news/saved/saved-view.tsx`). Used to list the surfaces in a step's
 * brief before any file has changed. An address names only the surfaces of
 * that page, not those of the pages beneath it.
 */
export function surfacesInText(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\/preview\?s=([\w-]+)/g)) {
    if (m[1] in SURFACE_ROUTES) found.add(m[1]);
  }
  for (const m of text.matchAll(/(?:^|[\s(`'"])(\/[a-z][\w\-/[\].]*)/gm)) {
    const route = m[1].replace(/[.,)\]]+$/, '').replace(/\/$/, '');
    if (route.startsWith('/preview')) continue;
    for (const id of surfacesForRoute(route)) found.add(id);
  }
  const files = [...text.matchAll(/\bapp\/[\w\-/[\]().@]+\.tsx\b/g)].map((m) => m[0]);
  for (const id of surfacesForFiles(files)) found.add(id);
  return Object.keys(SURFACE_ROUTES).filter((id) => found.has(id));
}
