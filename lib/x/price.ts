/**
 * What posting to X costs on pay-per-use (plan #2072), read from the owner's
 * X console on 14 October 2026. Apart from ./post.ts so the Posts tab's
 * client code can show prices without bundling the post check.
 */

/** USD per Post: Create request. */
export const X_POST_PRICE_USD = 0.015;
/** USD per Post: Create (with URL) request, about 13 times a plain post. */
export const X_POST_WITH_URL_PRICE_USD = 0.2;

/** "$0.015", "$0.200": three places, as X's console lists them. */
export function formatXPrice(usd: number): string {
  return `$${usd.toFixed(3)}`;
}
