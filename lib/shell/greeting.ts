import { zoneParts } from '@/lib/core/when';

/**
 * What time of day it is where the reader is, not where the server is: the
 * home page's greeting, and the line a new chat with Dash opens on.
 */
export function timeOfDayGreeting(timezone: string, now: Date): string {
  const hour = zoneParts(now, timezone).hour;
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The greeting with the first word of the person's name, when they have given one. */
export function greetingFor(timezone: string, now: Date, displayName: string | null): string {
  const first = displayName?.trim().split(/\s+/)[0];
  return `${timeOfDayGreeting(timezone, now)}${first ? `, ${first}` : ''}`;
}
