'use client';

/**
 * The role page's tabs, and the address that keeps the one you are on.
 *
 * The tab is part of the URL (`?tab=`), so a link, a refresh or the back
 * button lands where you were. Switching writes the address with the history
 * API rather than navigating, so the server does not load the role again for
 * a change only this component draws. The row is the tabbed sections
 * pattern's (components/patterns/tabbed-sections.tsx, plan #1626). Each tab
 * is its own file beside this one; what they are handed is `PanelProps` in
 * ./types.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  CalendarClock,
  FileText,
  ListChecks,
  Mail,
  MessageSquareText,
  MessagesSquare,
} from 'lucide-react';
import { TabbedSections } from '@/components/patterns/tabbed-sections';
import { Card } from '@/components/ui/card';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { dismissPursuit } from '@/app/jobs/(app)/pipeline/actions';
import type { InterviewSeed } from './shared';
import { ROLE_TAB_ADDRESS, roleTabFrom, roleTabSearch, type RoleTab } from './tabs';
import type { PanelProps } from './types';
import { Timeline } from './timeline';
import { Posting } from './posting';
import { Answers } from './application';
import { Interviews } from './interviews';
import { RoleComments } from './comments';
import { LinkedMail } from './mail';

export type { PanelProps } from './types';

const TABS: Array<{ id: RoleTab; label: string; icon: typeof FileText }> = [
  { id: 'timeline', label: 'Timeline', icon: ListChecks },
  { id: 'posting', label: 'Posting', icon: FileText },
  { id: 'answers', label: 'Application', icon: MessageSquareText },
  { id: 'interviews', label: 'Interviews', icon: CalendarClock },
  { id: 'notes', label: 'Comments', icon: MessagesSquare },
  { id: 'mail', label: 'Linked mail', icon: Mail },
];

export function RoleDetailPanels(
  props: PanelProps & {
    /** The tab to open on when the address names none: the page's choice for this stage. */
    defaultTab?: RoleTab;
  },
) {
  const searchParams = useSearchParams();
  const tab = roleTabFrom(searchParams.get('tab')) ?? props.defaultTab ?? 'timeline';
  const [interviewSeed, setInterviewSeed] = useState<InterviewSeed | null>(null);

  const openTab = (next: RoleTab) => {
    if (next === tab) return;
    window.history.pushState(null, '', roleTabSearch(searchParams.toString(), next));
  };

  // Adding the round from a message is one move, not "go to the other tab and
  // find the button": the seed opens the form there already filled in.
  const startInterviewFrom = (seed: InterviewSeed) => {
    setInterviewSeed(seed);
    openTab('interviews');
  };

  const counts: Partial<Record<RoleTab, number>> = {
    answers: props.answers.length,
    interviews: props.interviews.length,
    notes: props.thread.length,
    mail: props.messages.length,
  };
  const tabs = TABS.map((entry) => ({ ...entry, count: counts[entry.id] }));

  return (
    <div>
      {/* Shallow: the page already holds every tab's data for the counts, so
       * a switch writes the address without loading the role again, and a
       * seeded interview form survives the move to its tab. */}
      <TabbedSections
        tabs={tabs}
        label="Role"
        address={{ ...ROLE_TAB_ADDRESS, opensOn: props.defaultTab ?? 'timeline' }}
        shallow
      >
        {tab === 'timeline' && <Timeline {...props} />}
        {tab === 'posting' && <Posting {...props} />}
        {tab === 'answers' && <Answers {...props} />}
        {tab === 'interviews' && (
          <Interviews {...props} seed={interviewSeed} onSeedUsed={() => setInterviewSeed(null)} />
        )}
        {tab === 'notes' && <RoleComments roleId={props.roleId} thread={props.thread} />}
        {tab === 'mail' && <LinkedMail {...props} onAddInterview={startInterviewFrom} />}
      </TabbedSections>

      <NotRealPursuit applicationId={props.applicationId} />
    </div>
  );
}

/**
 * The same "this was not real" escape as the board, on the page you land on
 * when you click through to find out what a pursuit even is.
 *
 * Below the fold and behind a confirmation, because it removes the role and
 * usually the company with it. Nothing a person put there is touched: a
 * company with research on it, a contact, or a note survives its pursuit.
 */
function NotRealPursuit({ applicationId }: { applicationId: string }) {
  const router = useRouter();

  return (
    // On a quiet card of its own rather than under a rule: the sentence is
    // body text, and none sits bare on the page (plan #1686).
    <Card padding="dense" className="mt-8">
      {/* A sentence, because the button on its own was a grey line floating
       * under the page with nothing to say when it applied. "Remove it" is
       * unanswerable without knowing what *it* is -- and the confirm's own
       * prompt, which does explain, only appears after you have pressed the
       * thing you were unsure about. */}
      <p className="text-small text-ink-muted">
        An advert the scan mistook for a confirmation, or a role you never went for.
      </p>
      {/* Pulled back by the ghost button's own padding, so its words start
          under the sentence's rather than indented from it (law 18). */}
      <ConfirmStep
        className="-ml-2.5 mt-1"
        align="start"
        prompt="Remove this pursuit? The role goes with it, and the company too if nothing else is attached to it. Any mail that created it is marked not relevant, so the next sync will not bring it back."
        confirmLabel="Yes, remove it"
        pendingLabel="Removing…"
        onConfirm={async () => {
          const result = await dismissPursuit(applicationId);
          // Thrown rather than stored: ConfirmStep renders the error in place.
          if (result.error) throw new Error(result.error);
          router.push('/jobs/pipeline');
        }}
      >
        This was not a real pursuit — remove it
      </ConfirmStep>
    </Card>
  );
}
