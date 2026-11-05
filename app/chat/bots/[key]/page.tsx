import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { loadPeople } from '@/lib/you/chat-threads';
import { loadPersonCard } from '@/lib/you/people-cards';
import {
  correctPersonMemory,
  deletePersonCard,
  draftPersonCard,
  removePersonMemory,
  saveBotPhoto,
  savePersonCard,
  setReachOut,
  turnOffPersonReachOut,
} from '../../actions';
import { BotsView } from '../../bots-view';
import { PersonForm } from '../../people/person-form';

export const metadata = { title: 'Bots' };
export const dynamic = 'force-dynamic';

const KEY = /^[a-z0-9_-]{1,80}$/;

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * One bot on Chat's Bots tab (plan #2879.3): its form beside the list of
 * bots on a laptop, the form alone on a phone. The form is the one Messages
 * opened from Edit on a thread (plan #2748.11), with Delete at its foot.
 */
export default async function ChatBotPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!KEY.test(key)) notFound();
  const user = await requireUser();
  const client = await createYouClient();
  const now = readAt();
  const [rows, card, settings] = await Promise.all([
    loadPeople(client, user.id),
    loadPersonCard(client, user.id, key, now),
    loadAccountSettings(user.id),
  ]);
  if (!card) notFound();
  return (
    <BotsView rows={rows} current={key}>
      <PersonForm
        key={`${card.id}-${card.persona.length}`}
        card={card}
        timezone={settings.timezone}
        now={now}
        actions={{
          save: savePersonCard,
          draft: draftPersonCard,
          correct: correctPersonMemory,
          remove: removePersonMemory,
          delete: deletePersonCard,
          setReachOut,
          turnOffReachOut: turnOffPersonReachOut,
          photo: saveBotPhoto,
        }}
      />
    </BotsView>
  );
}
