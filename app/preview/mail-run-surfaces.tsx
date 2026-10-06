import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { LinkedText } from '@/components/ui/linked-text';
import { RunChanges } from '@/app/goals/runs/[runId]/run-changes';
import { BackButton, EmailFrame } from '@/app/mail/[id]/reader';
import { replyMailto } from '@/lib/email/gmail-open';
import type { GmailMessageContent } from '@/lib/email/providers/types';
import type { ChangeLine } from '@/lib/goals/run-changes';
import { JOB_LABELS, runMeta, type RunListing } from '@/lib/goals/runs';

/**
 * One goal run and one email in the gallery (plan #1601). Both pages are
 * server pages that read and then draw, so the drawing is repeated here from
 * the page's own components with fixtures: the run's header, summary and
 * changes with Undo, and a two-message conversation read inside the app,
 * the second message in its HTML frame.
 */

const NOW = Date.parse('2026-10-06T14:00:00Z');

// ---- A goal run -------------------------------------------------------------

const RUN: RunListing = {
  id: '6f0c2a7e-1b7d-4c55-9a0e-2d8f3c1b9a01',
  job: 'reshape',
  status: 'done',
  createdAt: '2026-10-06T12:41:00Z',
  endedAt: '2026-10-06T12:47:30Z',
  summary:
    'Read your answers on the visa question and the move. Settled the two steps that hung on them, added the three documents the application needs as a collection, and moved the interview practice phase ahead of the portfolio.',
  error: null,
  lastSeenAt: '2026-10-06T12:47:30Z',
  nowOn: null,
  item: { id: 'g1', title: 'Land a strategic finance role at a growth-stage company before the end of the year', level: 'goal' },
};

function line(key: string, sentence: string, over: Partial<ChangeLine> = {}): ChangeLine {
  return { key, sentence, actor: 'claude', state: 'undoable', reason: null, targets: [], ...over };
}

const LINES: ChangeLine[] = [
  line('1', 'Added the step "Ask Ramp\'s recruiter whether the role sponsors an H-1B transfer" under Applications.'),
  line('2', 'Settled "Decide on New York or remote" as New York, from your answer.'),
  line('3', 'Added the collection "Application documents" with three drafts: resume, cover letter, references.'),
  line('4', 'Moved the phase "Interview practice" ahead of "Portfolio".', {
    state: 'kept',
    reason: 'You moved it since',
  }),
  line('5', 'Renamed the step "Portfolio" to "Two worked models to share in interviews".', { state: 'undone' }),
  line('6', 'Marked "Update the resume" done.', { actor: 'me', state: 'none' }),
];

/** The markup of app/goals/runs/[runId]/page.tsx after its reads. */
export function GoalRunSurface() {
  const { meta } = runMeta(RUN, NOW, 'America/New_York');
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={JOB_LABELS[RUN.job]}
        description={
          <>
            {'On '}
            <Link href={`/goals/${RUN.item!.id}`} className="underline-offset-2 hover:underline">
              {RUN.item!.title}
            </Link>
            {' · '}
            {meta}
          </>
        }
        actions={
          <Link href="/goals/runs" className="press-area text-small text-ink-muted underline-offset-2 hover:underline">
            All runs
          </Link>
        }
      />
      <p className="text-small break-words whitespace-pre-wrap text-ink">
        <LinkedText text={RUN.summary!} />
      </p>
      <Card>
        <RunChanges runId={RUN.id} lines={LINES} />
      </Card>
    </div>
  );
}

// ---- An email ---------------------------------------------------------------

function message(over: Partial<GmailMessageContent> & Pick<GmailMessageContent, 'id'>): GmailMessageContent {
  return {
    threadId: 't1',
    internalDate: null,
    fromAddress: null,
    replyToAddress: null,
    subject: null,
    text: '',
    html: '',
    calendar: [],
    ...over,
  };
}

const MESSAGES: GmailMessageContent[] = [
  message({
    id: 'm1',
    internalDate: new Date('2026-10-03T14:12:00Z'),
    fromAddress: 'Christopher Kloughton <christopher.kloughton@example.com>',
    subject: 'Senior Financial Analyst, Revenue Operations and Planning: availability next week',
    text: 'Hi Dana,\n\nThanks for the note. I am free Tuesday after 1 pm or any time Thursday, Eastern.\n\nChris',
  }),
  message({
    id: 'm2',
    internalDate: new Date('2026-10-06T11:02:00Z'),
    fromAddress: 'Dana Whitfield-Okonkwo <dana.whitfield-okonkwo@recruiting.ramp.example.com>',
    subject: 'Re: Senior Financial Analyst, Revenue Operations and Planning: availability next week',
    html: '<p>Hi Chris,</p><p>Thursday 9 October at 2:00 pm Eastern works for Priya, who leads planning. The invite is on its way with a video link.</p><p>She will want to talk through a forecast you rebuilt, so bring one you can share your screen on.</p><p>Best,<br>Dana</p><p style="color:#666;font-size:12px">Ramp Recruiting · 28 West 23rd Street, New York</p>',
  }),
];

/** The markup of app/mail/[id]/page.tsx inside the shell, after its reads. */
export function MailMessageSurface() {
  const when = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/New_York',
  });
  const latest = MESSAGES.at(-1)!;
  const reply = replyMailto(latest);
  const subject = MESSAGES.find((m) => m.subject)?.subject ?? '(no subject)';

  return (
    <div className="mx-auto max-w-3xl">
      <BackButton />
      <PageHeader title={subject} description={`${MESSAGES.length} messages`} />
      <div className="mb-4 flex flex-wrap gap-2">
        {reply && (
          <a href={reply} className={buttonVariants({ variant: 'primary', size: 'md' })}>
            Reply
          </a>
        )}
        <a
          href="https://mail.google.com/mail/u/0/#all/t1"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'secondary', size: 'md' })}
        >
          Open in Gmail
        </a>
      </div>
      <Card padding="none">
        <ol className="divide-y divide-border">
          {MESSAGES.map((entry) => (
            <li key={entry.id} className="card-pad">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 break-words text-ui font-semibold text-ink">
                  {entry.fromAddress ?? 'Unknown sender'}
                </p>
                {entry.internalDate && (
                  <p className="tabular text-small text-ink-muted">{when.format(entry.internalDate)}</p>
                )}
              </div>
              {entry.html ? (
                <EmailFrame html={entry.html} title={entry.subject ?? 'Email'} />
              ) : (
                <p className="whitespace-pre-wrap break-words text-body text-ink">
                  <LinkedText text={entry.text || '(no text)'} />
                </p>
              )}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
