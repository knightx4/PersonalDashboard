import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createYouClient } from '@/lib/you/auth/server';
import { loadMentorPage, loadNote } from '@/lib/you/council';
import {
  forgetMentorMemory,
  makeTodoFromNote,
  reactToCouncilNote,
  readCouncilNotes,
  readMentor,
  sendMentorMessage,
  setCommitment,
  stopMentorWatch,
} from '../../council-actions';
import { loadAvatarSprite } from '@/lib/you/advisor-avatar-draw';
import { AdvisorAvatars } from '../../advisor-avatar';
import { MentorView } from './mentor-view';

export const dynamic = 'force-dynamic';

/** The time the page is read; outside the component, since reading the clock during render is unstable. */
function readAt(): number {
  return Date.now();
}

const KEY = /^[a-z0-9_]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata = { title: 'Mentor' };

/**
 * One mentor on the Council (you 0037): their notes, the talk with them,
 * what they hold the person to and what they know. `?about=<note id>` opens
 * the talk about one of their notes, as Talk about this on a note does.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ about?: string }>;
}) {
  const { key } = await params;
  const { about } = await searchParams;
  if (!KEY.test(key)) notFound();
  const user = await requireUser();
  const client = await createYouClient();
  const now = readAt();
  const [page, settings, avatars] = await Promise.all([
    loadMentorPage(client, user.id, key, now),
    loadAccountSettings(user.id),
    loadAvatarSprite(client, user.id),
  ]);
  if (!page) notFound();
  const aboutNote = about && UUID.test(about) ? await loadNote(client, user.id, about) : null;

  return (
    <AdvisorAvatars {...avatars}>
      <MentorView
        mentor={page.mentor}
        brain={page.brain}
        notes={page.notes}
        chat={page.chat}
        messages={page.messages}
        memory={page.memory}
        watches={page.watches}
        about={aboutNote && aboutNote.advisorId === page.mentor.id ? aboutNote : null}
        timezone={settings.timezone}
        now={now}
        subject={{
          ref: null,
          path: [
            { label: 'You', href: '/you' },
            { label: 'Council', href: '/you/council' },
            { label: page.mentor.name, href: `/you/council/mentors/${key}` },
          ],
        }}
        actions={{
          read: readCouncilNotes,
          react: reactToCouncilNote,
          todo: makeTodoFromNote,
          readMentor,
          send: sendMentorMessage,
          commitment: setCommitment,
          forget: forgetMentorMemory,
          stopWatch: stopMentorWatch,
        }}
      />
    </AdvisorAvatars>
  );
}
