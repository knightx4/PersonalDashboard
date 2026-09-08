import type { ModuleId } from '@/lib/modules';
import type { PlanStatus } from './load';

/**
 * The build order, transcribed once.
 *
 * This is a snapshot, not a mirror. `docs/BUILD-ORDER.md` and
 * `docs/EVIDENCE-LAYER.md` were the plan until now and remain the record of
 * why each step is where it is; what they cannot be is a plan you work, since
 * a deployed app cannot write to a file in the repository. So the rows below
 * seed the plan once and the app owns it afterwards — nothing re-reads the
 * markdown, and the two are expected to drift.
 *
 * The statuses are the ones the documents assert (a ✅ against a numbered
 * step), checked against the code where the document does not say outright.
 * Where they are wrong they are wrong in the direction of not claiming
 * something shipped, and the whole point of the page is that you can correct
 * one in a click.
 */

export interface PlanSeedItem {
  module: ModuleId | null;
  title: string;
  detail: string | null;
  status: PlanStatus;
}

/**
 * Numbered as the build order numbers them, because those numbers are how the
 * documents and half the commit messages refer to these steps. The number is
 * part of the title rather than a column: renumbering a list you can insert
 * into is a job nobody wants, and the numbers stop meaning anything the first
 * time you add a step of your own.
 */
export const PLAN_SEED: readonly PlanSeedItem[] = [
  // ---------------------------------------------------------------- shopping
  {
    module: 'shopping',
    title: '0. Google Cloud setup',
    detail:
      'Deferred deliberately — not needed until Gmail OAuth, which landed as step 7. See SETUP.md Tier 2.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '1. Schema and migrations',
    detail:
      'All tables, profiles and its insert trigger, item_uses, both fingerprint columns. RLS on every table; categories and merchants written by hand and seeded.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '2. The cross-user isolation test',
    detail:
      'Written before any feature code, so a missing policy fails immediately rather than months later.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '3. lib/money.ts',
    detail: 'The allocation rule and spend queries, plus the January/March return fixture.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '4. Supabase Auth',
    detail:
      'Sign-up, sign-in, Google sign-in, password reset, session refresh and route protection in proxy.ts.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '5. App shell, navigation, empty states',
    detail: 'No data yet.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '6. Manual order entry plus inventory CRUD',
    detail:
      'One inventory_items row per physical unit via allocateLandedCost. Inventory list/detail with search, filter, edit, note, dispose and return. Orders list grouped by month, plus detail.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '7. Gmail OAuth grant and connection management',
    detail: 'Connect / disconnect / reconnect on Settings; tokens encrypted at rest.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '8. Email extraction and inbox sync',
    detail:
      'Classifier on merchant domains, Zod extraction with the arithmetic gate, Gmail message fetch, and session-scoped sync batches that write orders and inventory.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '9. Dashboard',
    detail: 'On top of order and inventory data, reading only from lib/money.ts.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '10. Saved items',
    detail:
      'Paste URL, JSON-LD then Open Graph enrichment, preview/edit, save. List by status, detail edit, dismiss / purchased / delete. Loose fingerprint already-own warning. No paid unfurl vendor yet.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '11. Onboarding flow',
    detail:
      'Welcome, Gmail pre-consent explanation, connect or skip. Existing users with inbox or orders are grandfathered.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '12. Background Gmail backfill',
    detail:
      'Import starts on the server and survives navigation; Settings and Dashboard poll sync_jobs for progress. Full Inngest remains optional hardening.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '13. Incremental sync',
    detail:
      'Gmail historyId, durable cursor on email_accounts.sync_cursor, daily cron plus "Sync now". Expired history falls back to a bounded messages.list catch-up.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '14. Review queue',
    detail:
      'Heuristic orders and failed or unmatched emails. Confirm, discard or dismiss; Open in Gmail; nav badge counts both.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '15. Account deletion',
    detail: 'With token revocation and full cascade. The vault, todo and learn tables all cascade from auth.users already.',
    status: 'not_started',
  },
  {
    module: 'shopping',
    title: '16. Books resolution engine',
    detail: 'ISBN or title to a canonical book via Google Books and Open Library, tested with fixtures.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '17. Owned-book ingestion',
    detail:
      'Manual search, paste list, barcode scan, shelf and cover photo with mandatory confirm, receipt photo. book_details table; standalone inventory with no synthetic orders.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '18. Sell assistant v1',
    detail:
      'Buyback quotes and eBay Browse asking ceiling, net_self / net_buyback maths, routing UI on /sell.',
    status: 'done',
  },
  {
    module: 'shopping',
    title: '19. Phase 2 — the anti-spending layer',
    detail:
      'No migrations needed: the schema already carries item_uses, the budget columns and cooldown_until. price_checks for saved items waits until then too.',
    status: 'not_started',
  },

  // ------------------------------------------------------------------- vault
  {
    module: 'vault',
    title: '20. Schema and the isolation test',
    detail:
      'The obsidian schema — vault_connections, notes, sync_runs — with RLS on all three and the cross-user isolation test extended before any feature code.',
    status: 'done',
  },
  {
    module: 'vault',
    title: '21. The GitHub source',
    detail:
      'Containment enforced the way lib/email/providers already is. Tree call filtered to .md before any blob is requested, so attachment bytes never cross the network.',
    status: 'done',
  },
  {
    module: 'vault',
    title: '22. The viewer',
    detail:
      'List, note detail, search. react-markdown with remark-gfm and gray-matter, and deliberately not rehype-raw — disabled raw HTML is the sanitizer.',
    status: 'done',
  },
  {
    module: 'vault',
    title: '23. Connect UI',
    detail:
      '/vault/settings — connect, disconnect, sync now, and a reauth banner on an expired PAT.',
    status: 'done',
  },

  // -------------------------------------------------------------------- todo
  {
    module: 'todo',
    title: '24. Account settings',
    detail:
      'core.account_settings, and the timezone moved into it. Account-level settings behind the account icon; each module keeps its own gear. First, because everything below renders a date.',
    status: 'done',
  },
  {
    module: 'todo',
    title: '25. Schema and the isolation test',
    detail:
      'The todo schema, applied last because its foreign keys point into the other three. RLS and the link-ownership trigger, both covered before any feature code — a foreign key is not an ownership check.',
    status: 'done',
  },
  {
    module: 'todo',
    title: '26. The list you typed',
    detail: '/todo and /todo/all: create, edit, complete, drop, snooze, due dates, pinned. Zero integration, and already worth having.',
    status: 'done',
  },
  {
    module: 'todo',
    title: '27. Links and the inline sections',
    detail:
      'todo.task_links, real cross-schema foreign keys, one parent from six. A Tasks section on the role, company, contact and interview pages and on a note.',
    status: 'done',
  },
  {
    module: 'todo',
    title: '28. The source registry',
    detail:
      'The AgendaSource interface, the switches in /todo/settings, batched label lookups and the pure merge, with no sources implemented. The step that decides whether the next two are one file each or a rewrite.',
    status: 'done',
  },
  {
    module: 'todo',
    title: '29. The job source',
    detail:
      'Reminders on the agenda with the follow-up composer intact. Completion and deferral write to the job row. Interviews as day context rather than as items.',
    status: 'done',
  },
  {
    module: 'todo',
    title: '30. The shopping source',
    detail: 'orders.return_deadline within the horizon. Last of the sources because it is the thinnest.',
    status: 'done',
  },
  {
    module: 'todo',
    title: '31. /home',
    detail: 'The top slice of the agenda on the front door, plus tiles for the vault and the todo module.',
    status: 'done',
  },

  // ------------------------------------------------------------------- learn
  {
    module: 'learn',
    title: '32. Schema, RLS and the isolation test',
    detail: 'Four tables in learn, policies in the first migration, rls-learn.test.ts written before any feature code.',
    status: 'done',
  },
  {
    module: 'learn',
    title: '33. The guarded fetcher',
    detail:
      'The first integration that reaches an address nobody here chose, so the address guard, the redirect re-check and the containment boundary come before anything that would use them.',
    status: 'done',
  },
  {
    module: 'learn',
    title: '34. Parse and resolve',
    detail:
      'A paste becomes citations; each citation becomes a source with a link, an access and a proposed location. Separate steps so one bad row does not cost the whole import.',
    status: 'done',
  },
  {
    module: 'learn',
    title: '35. The locate pass',
    detail:
      'Fetch on open, find the passage, verify the phrase is really in the page. Where "never send someone to a page that is not there" stops being a sentence in a spec.',
    status: 'done',
  },
  {
    module: 'learn',
    title: '36. The workspace',
    detail: 'Tracks, a track, a reading, and the paste-and-confirm intake.',
    status: 'done',
  },

  // -------------------------------------------------------------------- jobs
  // From EVIDENCE-LAYER.md, which is the job side's own plan: six slices, each
  // useless without the one above it. It has no ✅ convention, so these were
  // read off the code.
  {
    module: 'jobs',
    title: '1. Fill the bank',
    detail:
      'The quality ceiling of every draft this app will ever write is set here. A six-field form adding one item at a time is not a way anybody fills a bank of twenty.',
    status: 'done',
  },
  {
    module: 'jobs',
    title: '2. The match',
    detail: 'The requirement map, with evidence beside each line.',
    status: 'done',
  },
  {
    module: 'jobs',
    title: '3. The number, where you decide',
    detail: 'Coverage on the board, so the top of the sorted list is where the effort goes.',
    status: 'done',
  },
  {
    module: 'jobs',
    title: '4. Answer drafting, cited',
    detail: 'Every sentence traces to an item you actually wrote, and what it cannot ground it says so.',
    status: 'done',
  },
  {
    module: 'jobs',
    title: '5. The case page',
    detail: 'A link renders the map for one application and expires on schedule.',
    status: 'done',
  },
  {
    module: 'jobs',
    title: '6. Retire the phase language',
    detail:
      'Find the "Phase 2" references and point them at the evidence layer, or delete them where the thing has shipped. Still live in lib/db/schema.ts.',
    status: 'not_started',
  },
];
