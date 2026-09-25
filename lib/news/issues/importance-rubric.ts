/**
 * How a story's importance is judged, written once for both places that rate
 * it: the digest call that summarises a new newsletter (digest.ts) and the
 * catch-up that rates stories stored before ratings existed (importance.ts).
 * One wording keeps the two scales the same.
 *
 * The rating is about the news, not the reader: what you tend to open is
 * learned separately (lib/news/quick/rank.ts), and a rating that leaned on
 * your habits would count them twice.
 */
export const IMPORTANCE_RUBRIC = `IMPORTANCE. Rate each story from 1 to 5 for how much a
well-informed general reader needs to know it. Judge the event itself, not how
prominently this newsletter places it or how it is written.
5: Major news of wide consequence, the kind that leads front pages: a war or
   attack, an election result, a landmark court ruling or law, a market-moving
   event, a disaster, the death of a head of state.
4: A significant development with real consequences for many people or for a
   whole field, such as a major policy decision, a large company's results or
   deal, or an important scientific finding.
3: Solid news of moderate consequence, or of real interest within its field.
2: Minor news: incremental updates, niche items, small product launches,
   personal finance or career tips.
1: Light items: trivia, quizzes, lifestyle filler, jokes, recommendations,
   promotions, and anything about the newsletter itself.
Most stories are 2 or 3. Keep 5 for the few a reader would be embarrassed to
have missed.`;
