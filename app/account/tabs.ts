import type { Tab, TabAddress } from '@/lib/tabs';

/**
 * Account's tabs (the tabbed sections pattern, plan #1628). Ten sections
 * grouped into five, each a peer looked at on its own:
 *
 * - You: name, timezone and display currency.
 * - Workspaces: which are on, and where each one's own settings live.
 * - Notifications: the morning brief on this device, and how the app feels
 *   in the hand. Both are set per device.
 * - Activity: the apps connected through Dash's connector and what they
 *   called, the model spend, and the timeline of everything you did.
 * - Session: signing out, and deleting the account at the foot.
 */
export const ACCOUNT_TABS = [
  { id: 'you', label: 'You' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'activity', label: 'Activity' },
  { id: 'session', label: 'Session' },
] as const satisfies readonly Tab[];

export type AccountTab = (typeof ACCOUNT_TABS)[number]['id'];

/**
 * Links written before Account had tabs pointed at a section's anchor, such
 * as the `#notifications` Dash gave when a watch would reach no phone. The
 * strip moves those onto the tab that holds the section.
 */
export const ACCOUNT_TAB_ADDRESS = {
  anchors: { notifications: 'notifications' },
} as const satisfies TabAddress;
