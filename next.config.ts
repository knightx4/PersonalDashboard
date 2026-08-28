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
  async redirects() {
    return MOVED_TO_SHOPPING.map((section) => ({
      source: `/${section}/:path*`,
      destination: `/shopping/${section}/:path*`,
      permanent: false,
    }));
  },
};

export default nextConfig;
