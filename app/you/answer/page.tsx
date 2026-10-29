import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { loadDashQuestions } from '@/lib/you/dash-questions';
import { AnswerView } from './answer-view';

export const metadata = { title: 'Answer' };
export const dynamic = 'force-dynamic';

/**
 * You's Answer tab (plan #2617.2): Dash's questions about you, open ones to
 * answer or skip, then your answers to edit and the skipped ones folded. A
 * failed read throws to the You error boundary (app/you/error.tsx).
 */
export default async function Page() {
  const user = await requireUser();
  const [{ open, past }, settings] = await Promise.all([
    loadDashQuestions(await createYouClient(), user.id),
    loadAccountSettings(user.id),
  ]);
  return <AnswerView open={open} past={past} timezone={settings.timezone} />;
}
