import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { loadPeople, type PersonRow } from '@/lib/you/chat-threads';
import { newPersonCard } from '@/lib/you/people-cards-model';
import { correctPersonMemory, deletePersonCard, draftPersonCard, removePersonMemory, saveBotPhoto, savePersonCard } from '../actions';
import { BotsView } from '../bots-view';
import { PersonForm } from '../people/person-form';

export const metadata = { title: 'Bots' };
export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

/**
 * Chat's Bots tab (plan #2879.3): every bot A to Z, and on a laptop a
 * prompt to choose one beside them. `?add=1` opens the form for a new bot
 * in the form's place.
 */
export default async function ChatBotsPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const { add } = await searchParams;
  const user = await requireUser();
  const client = await createYouClient();
  const [found, settings] = await Promise.all([
    loadPeople(client, user.id).then(
      (rows): { rows: PersonRow[]; failed?: true } => ({ rows }),
      (error: unknown): { rows: PersonRow[]; failed?: true } => {
        console.error('chat bots were not read', error);
        return { rows: [], failed: true };
      },
    ),
    loadAccountSettings(user.id),
  ]);
  if (add === '1' && !found.failed) {
    return (
      <BotsView rows={found.rows} adding>
        <PersonForm
          card={newPersonCard(found.rows.map((r) => r.colour))}
          timezone={settings.timezone}
          now={readAt()}
          actions={{ save: savePersonCard, draft: draftPersonCard, correct: correctPersonMemory, remove: removePersonMemory, delete: deletePersonCard, photo: saveBotPhoto }}
        />
      </BotsView>
    );
  }
  return <BotsView rows={found.rows} failed={found.failed} />;
}
