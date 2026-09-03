import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { TodoTopNav } from '@/components/todo/shell/top-nav';

/**
 * Shell for the todo workspace.
 *
 * The proxy already blocks unauthenticated requests; the check here is a second
 * line, not the first.
 *
 * No onboarding gate, for the same reason the vault has none: neither
 * workspace's onboarding says anything about a todo list, and bouncing someone
 * to a Gmail consent screen because they wanted to write down "renew the
 * passport" would be the wrong app answering the question.
 */
export default async function TodoLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const settings = await loadAccountSettings(user.id);

  return (
    <div className="min-h-full">
      <TodoTopNav
        displayName={settings.displayName}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
      />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
