'use server';

import { cookies } from 'next/headers';
import { getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { isThemeId, THEME_COOKIE, THEME_COOKIE_MAX_AGE, type ThemeChoice } from '@/lib/theme';

/**
 * Store the chosen theme.
 *
 * Two places, deliberately. `core.account_settings` is the truth and follows
 * the account across devices; the cookie is a mirror that exists so the root
 * layout can put `data-theme` on <html> in the first byte it sends.
 *
 * The cookie is also the whole story on the signed-out pages, which is why it
 * is written first and unconditionally -- a person choosing a theme on the
 * sign-in screen should keep it.
 *
 * Null clears both, which is not the same as choosing light: it means follow
 * the system again.
 */
// latency: instant -- the picker recolours the page itself and does not wait for the write
export async function setTheme(next: string | null): Promise<void> {
  const theme: ThemeChoice = isThemeId(next) ? next : null;

  const jar = await cookies();
  if (theme) {
    jar.set(THEME_COOKIE, theme, {
      maxAge: THEME_COOKIE_MAX_AGE,
      sameSite: 'lax',
      path: '/',
    });
  } else {
    jar.delete(THEME_COOKIE);
  }

  const user = await getUser();
  if (!user) return;

  const supabase = await createCoreClient();
  // Best effort: a failed write costs this device's preference on the next
  // machine, and losing the click entirely would be worse.
  await supabase
    .from('account_settings')
    .upsert({ user_id: user.id, theme }, { onConflict: 'user_id' });
}
