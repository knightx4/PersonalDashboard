import type { NextConfig } from "next";

/**
 * The commerce side used to live at the root -- /orders, /inventory, /settings
 * and so on. It now sits under /shopping so the job search side can sit beside
 * it under /jobs without either owning the top level.
 *
 * These are 307s rather than 308s on purpose. Everything below is behind a
 * login, so there is no SEO to preserve and the only thing a permanent
 * redirect would buy is browser-side caching -- against which it would also be
 * cached irrevocably in every browser that ever followed one, which is a poor
 * trade for a layout that may still be tuned.
 */
const MOVED_TO_SHOPPING = [
  "dashboard",
  "feedback",
  "inventory",
  "orders",
  "returns",
  "review",
  "saved",
  "sell",
  "settings",
];

const nextConfig: NextConfig = {
  /**
   * CI and the gate run `tsc --noEmit` as their own step before the build,
   * so checking types again inside `next build` only doubled the memory: the
   * check alone takes about 5 GB, and it ran the build out of memory on CI in
   * October 2026. They set SKIP_BUILD_TYPECHECK=1. Vercel does not, so a
   * deploy still refuses to build with a type error.
   */
  typescript: {
    ignoreBuildErrors: process.env.SKIP_BUILD_TYPECHECK === '1',
  },
  /**
   * /dev/specs reads the documents in `docs/` off disk at request time, and
   * nothing imports them, so the tracer is right to leave them out of the
   * deployment unless told otherwise. Without this the page is empty in
   * production and correct everywhere else, which is the worst shape a bug
   * can take.
   */
  outputFileTracingIncludes: {
    '/dev/specs/[slug]': ['./docs/**/*.md'],
    // An overhaul's row reads its spec's Contract for the rule counts it
    // shows (plan #1516), on the plan and on a project's copy of it.
    '/dev/plan': ['./docs/**/*.md'],
    '/dev/projects/[id]': ['./docs/**/*.md'],
    // The memory sweep copies the specs into search by meaning (plan #1321),
    // and Ask Dash reads them in the app and over MCP (read_spec, find_dev_text).
    '/api/cron/memory-sweep': ['./docs/**/*.md'],
    '/chat/dash': ['./docs/**/*.md', './public/posts/*.png'],
    '/chat/dash/*': ['./docs/**/*.md', './public/posts/*.png'],
    '/api/mcp': ['./docs/**/*.md', './public/posts/*.png'],
    // The sheet asks through this route, which streams the lookups (plan #1438).
    '/api/ask': ['./docs/**/*.md', './public/posts/*.png'],
    // A screen step's row shows the mockup registered for the screen, whose
    // pictures are kept under docs/references (plan #2215.10).
    '/dev/plan/reference': ['./docs/references/**/*.{png,jpg,jpeg,webp}'],
  },

  async redirects() {
    return [
      ...MOVED_TO_SHOPPING.map((section) => ({
        source: `/${section}/:path*`,
        destination: `/shopping/${section}/:path*`,
        permanent: false,
      })),
      /**
       * News opens on Quick read and the newsletter list moved to /news/all
       * (#848). A list filtered to one sender was /news?from=, so that still
       * reaches the list; the query is carried across. Quick read itself was
       * /news/quick for a day, and that comes back to /news.
       */
      {
        source: '/news',
        has: [{ type: 'query' as const, key: 'from' }],
        destination: '/news/all',
        permanent: false,
      },
      { source: '/news/quick', destination: '/news', permanent: false },
      /**
       * A month of opens folded three News pages into the ones that hold
       * them (plan #1496.10): Inbox and the Daily review show on Now, and a
       * story's slide is the story as the newsletter's page lists it. Old
       * links in briefs, notifications and Dash's replies still open them;
       * a review's ?day= rides across to Now.
       */
      { source: '/news/inbox', destination: '/news', permanent: false },
      { source: '/news/review', destination: '/news', permanent: false },
      { source: '/news/i/:id/s/:index', destination: '/news/i/:id', permanent: false },
      /**
       * Education moved from the Vault to You's Work & school tab (plan
       * #1991.3). A course or transcript link keeps its #anchor, which the
       * browser carries across the redirect, and a transcript's file link
       * keeps its id.
       */
      { source: '/vault/education/:path*', destination: '/you/work/:path*', permanent: false },
      /**
       * Spending and Recurring moved from Shopping to Finances (plan
       * #2593.1). Links already written into notes, briefs, todos and Dash's
       * replies still open them; the query (?range=, ?person=) is carried
       * across. The bare /dashboard of the oldest links reaches Shopping's
       * old address above and comes on from there.
       */
      { source: '/shopping/dashboard/:path*', destination: '/finances/spending/:path*', permanent: false },
      { source: '/shopping/recurring/:path*', destination: '/finances/recurring/:path*', permanent: false },
      /**
       * A month of opens folded two Shopping pages into the tabs they sit
       * under (plan #1496.8): Returns into Inventory and the review queue
       * into Now, the orders list. Links already written into briefs,
       * todos, notifications and Dash's replies still open them, with
       * their ?view=, ?merchant= and ?group= carried across. The bare
       * /returns and /review of the oldest links reach these from above.
       */
      { source: '/shopping/returns', destination: '/shopping/inventory/returns', permanent: false },
      { source: '/shopping/review', destination: '/shopping/orders/review', permanent: false },
      /**
       * The Board tab became the Council. Its list of questions and meetings
       * is now /you/council/decisions; a meeting, the roster and a panel
       * keep their paths under /you/council. Links already written into
       * notifications, minutes and Dash's replies still open them.
       */
      { source: '/you/board', destination: '/you/council', permanent: false },
      { source: '/you/board/:path*', destination: '/you/council/:path*', permanent: false },
      /**
       * Ask Dash moved into the Chat workspace's Dash tab (plan #2748.1). A
       * chat's link, New chat (?chat=new, carried across) and the Writing
       * style page keep working from notes, notifications and Dash's replies.
       */
      /**
       * You's Answer tab became Ask (plan #2635.3). Links already written
       * into insights, notes and Dash's replies still open it.
       */
      { source: '/you/answer', destination: '/you/ask', permanent: false },
      { source: '/ask', destination: '/chat/dash', permanent: false },
      { source: '/ask/:path*', destination: '/chat/dash/:path*', permanent: false },
    ];
  },
};

export default nextConfig;
