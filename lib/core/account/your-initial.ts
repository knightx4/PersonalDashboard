import 'server-only';

import { cache } from 'react';
import { loadAccountSettings } from '@/lib/core/account/settings';

/**
 * The letter the account button carries: the first of your display name, or
 * of your email when there is none (components/shell/app-shell.tsx).
 *
 * Read by a page that draws Assignee cells, which hands it to
 * `YourInitialProvider` (components/plan-tree/assignee-cell.tsx): the dev
 * plan and a feature's page now, a goal's page from plan #2069.2. Cached per
 * request, so a page that asks twice reads the settings once.
 */
export const loadYourInitial = cache(
  async (user: { id: string; email?: string | null }): Promise<string | null> => {
    const settings = await loadAccountSettings(user.id);
    const letter = (settings.displayName || user.email || '').charAt(0).toUpperCase();
    return letter || null;
  },
);
