'use client';

/**
 * The role page's tabs, and the address that keeps the one you are on.
 *
 * The tab is part of the URL (`?tab=`), so a link, a refresh or the back
 * button lands where you were. Switching writes the address with the history
 * API rather than navigating, so the server does not load the role again for
 * a change only this component draws. Each tab is its own file beside this
 * one; what they are handed is `PanelProps` in ./types.
 */
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  FileText,
  ListChecks,
  Mail,
  MessageSquareText,
  MessagesSquare,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { dismissPursuit } from '@/app/jobs/(app)/pipeline/actions';
import type { InterviewSeed } from './shared';
import { roleTabFrom, roleTabSearch, type RoleTab } from './tabs';
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
  const navRef = useRef<HTMLElement>(null);

  // At phone width the strip scrolls, and a page that opens on Interviews or
  // Comments would otherwise have its own tab out of sight. Brought into view
  // along the strip only, so the page itself does not move.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const strip = nav.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.left < strip.left || box.right > strip.right) {
      nav.scrollLeft += box.left - strip.left - 16;
    }
  }, [tab]);

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

  return (
    <div>
      <nav
        ref={navRef}
        aria-label="Role"
        className="mb-4 flex gap-1 overflow-x-auto border-b border-border max-lg:scroll-fade-x"
      >
        {TABS.map((entry) => {
          const active = tab === entry.id;
          const count =
            entry.id === 'answers'
              ? props.answers.length
              : entry.id === 'interviews'
                ? props.interviews.length
                : entry.id === 'notes'
                  ? props.thread.length
                  : entry.id === 'mail'
                    ? props.messages.length
                    : undefined;
          return (
            // A real address, so a tab can be opened in a new window or
            // copied; a plain press switches in place.
            <a
              key={entry.id}
              href={roleTabSearch(searchParams.toString(), entry.id)}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                openTab(entry.id);
              }}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-ui font-medium transition-colors duration-quick sm:min-h-0',
                active
                  ? 'border-accent text-accent'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              <entry.icon className="size-4" strokeWidth={1.75} aria-hidden />
              {entry.label}
              {count !== undefined && count > 0 && (
                <span className="tabular text-ink-muted">{count}</span>
              )}
            </a>
          );
        })}
      </nav>

      {tab === 'timeline' && <Timeline {...props} />}
      {tab === 'posting' && <Posting {...props} />}
      {tab === 'answers' && <Answers {...props} />}
      {tab === 'interviews' && (
        <Interviews {...props} seed={interviewSeed} onSeedUsed={() => setInterviewSeed(null)} />
      )}
      {tab === 'notes' && <RoleComments roleId={props.roleId} thread={props.thread} />}
      {tab === 'mail' && <LinkedMail {...props} onAddInterview={startInterviewFrom} />}

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
    <div className="mt-8 border-t border-border pt-4">
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
    </div>
  );
}
