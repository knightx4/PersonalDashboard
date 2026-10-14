/**
 * The anchor each section of an inbox is reached by, from a link elsewhere
 * (components/inbox/inbox-page.tsx draws the sections).
 */
export function inboxAnchor(key: string): string {
  return `inbox-${key}`;
}
