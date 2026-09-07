/**
 * What applying an answer actually does, decided without touching anything.
 *
 * Split out of lib/share/apply.ts on the same principle the vault sync uses:
 * the planning is pure and tested, and the runner does what the plan says. The
 * interesting decisions here -- which of three identical boxes gets sold, and
 * what is left of the answer afterwards -- are exactly the ones worth pinning
 * down in a test rather than reading back out of a Supabase call chain.
 */

export type ApplicationPlan = {
  /** Units to mark sold, in the order they will be taken. */
  sellIds: string[];
  /** Units to mark given away. */
  giveIds: string[];
  /**
   * What the answer should say afterwards, or null to delete it. An answer
   * left standing after it has been acted on shows her a request she already
   * granted, and reads as over-quantity on her next visit.
   */
  nextResponse: { keepQty: number; sellQty: number; giveawayQty: number } | null;
  /** Asked for more than is still owned. Reported rather than hidden. */
  shortfall: number;
};

export function planGroupApplication(input: {
  /**
   * Still-owned unit ids for this group. Order matters and is the caller's:
   * ascending by id, so the choice between identical boxes is arbitrary but
   * repeatable, and can be explained when someone asks why that one.
   */
  ownedIds: readonly string[];
  sellQty: number;
  giveawayQty: number;
  response: { keepQty: number; sellQty: number; giveawayQty: number } | null;
}): ApplicationPlan {
  const sellWanted = Math.max(0, Math.trunc(input.sellQty));
  const giveWanted = Math.max(0, Math.trunc(input.giveawayQty));

  const sellIds = input.ownedIds.slice(0, sellWanted);
  const giveIds = input.ownedIds.slice(sellIds.length, sellIds.length + giveWanted);

  const shortfall = sellWanted + giveWanted - sellIds.length - giveIds.length;

  let nextResponse: ApplicationPlan['nextResponse'] = null;
  if (input.response) {
    const keepQty = Math.max(0, input.response.keepQty);
    const nextSell = Math.max(0, input.response.sellQty - sellIds.length);
    const nextGive = Math.max(0, input.response.giveawayQty - giveIds.length);
    // Nothing left to say: keeping is not a request, so an answer that is only
    // "keep 0" is an empty row rather than a record of anything.
    nextResponse =
      keepQty === 0 && nextSell === 0 && nextGive === 0
        ? null
        : { keepQty, sellQty: nextSell, giveawayQty: nextGive };
  }

  return { sellIds, giveIds, nextResponse, shortfall };
}
