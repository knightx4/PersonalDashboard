/**
 * The words every Inbox uses for putting a row off and turning one down
 * (docs/ONE-INTERFACE-SPEC.md Part 4). Kept out of the client component so
 * server code building rows (lib/inbox/agenda-rows.ts) reads the same words.
 */
export const INBOX_WORDS = {
  later: 'Later',
  decline: 'Decline',
  bringBack: 'Bring back',
} as const;
