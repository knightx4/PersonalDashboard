import { createGoalsClient } from '@/lib/goals/auth/server';
import { createYouClient } from '@/lib/you/auth/server';
import type { RosterAdvisor } from '@/lib/you/board-advisors';
import type { Brain } from '@/lib/you/board-brain';
import { messageTurn, openersFor, type Opener } from '@/lib/you/advisor-talk';
import {
  listAdvisorChats,
  loadAdvisorMemory,
  loadAdvisorMessages,
  loadOpenDecisions,
  loadTalkGoals,
} from '@/lib/you/advisor-talk-store';
import { forgetAdvisorMemory, sendToAdvisor } from './talk-actions';
import { TalkTab } from './talk-view';

/**
 * The Talk tab's rows, read while the rest of the profile is already drawn
 * (plan #2581.6): the talks with this advisor, the open one's messages, what
 * the advisor remembers, and the openers for a first talk. `chat` from the
 * address picks the talk; absent, the latest one is carried on, and "new"
 * opens a new one.
 */
export async function TalkSection({
  userId,
  advisor,
  brain,
  chat,
  timeZone,
}: {
  userId: string;
  advisor: RosterAdvisor;
  brain: Brain | null;
  chat: string | null;
  timeZone: string;
}) {
  const you = await createYouClient();
  const [chats, memory] = await Promise.all([
    listAdvisorChats(you, userId, advisor.id),
    loadAdvisorMemory(you, userId, advisor.id),
  ]);
  const open = chat === 'new' ? null : (chats.find((c) => c.id === chat) ?? (chat ? null : (chats[0] ?? null)));
  const turns = open ? (await loadAdvisorMessages(you, userId, open.id)).map(messageTurn) : [];
  let openers: Opener[] = [];
  if (turns.length === 0) {
    const goals = await createGoalsClient();
    const [decisions, goalRows] = await Promise.all([
      loadOpenDecisions(you, userId),
      loadTalkGoals(goals, userId).catch(() => []),
    ]);
    openers = openersFor({ advisor, brain, open: decisions, goals: goalRows });
  }
  return (
    <TalkTab
      advisor={advisor}
      data={{ chats, chat: open, turns, memory, openers }}
      actions={{ send: sendToAdvisor, forget: forgetAdvisorMemory }}
      timeZone={timeZone}
    />
  );
}
