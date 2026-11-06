/**
 * Words for a custom watch that a client component can import. They live
 * apart from lib/you/advisor-watch.ts, which pulls in the model client and
 * the query code (plan #3030.1.4).
 */

/** "every day", "every week", "every 3 days". */
export function cadenceWords(everyDays: number): string {
  if (everyDays === 1) return 'every day';
  if (everyDays === 7) return 'every week';
  if (everyDays === 14) return 'every two weeks';
  if (everyDays === 30) return 'every month';
  return `every ${everyDays} days`;
}
