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
    '/ask': ['./docs/**/*.md'],
    '/ask/*': ['./docs/**/*.md'],
    '/api/mcp': ['./docs/**/*.md'],
    // The sheet asks through this route, which streams the lookups (plan #1438).
    '/api/ask': ['./docs/**/*.md'],
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
    ];
  },
};

export default nextConfig;
