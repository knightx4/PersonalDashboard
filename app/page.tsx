import type { CSSProperties } from 'react';
import Link from 'next/link';
import { ModuleMark } from '@/components/ui/module-mark';
import { modulesFor, type AppModule, type ModuleId } from '@/lib/modules';
import { cn } from '@/lib/cn';
import s from './front-door.module.css';

/**
 * Public homepage. Google requires a working homepage on a verified domain
 * before a restricted-scope app can be brand-verified, and a human reviewer
 * reads this page, so it has to describe what the app actually does.
 *
 * It is drawn in Aurora for every visitor (front-door.module.css says why),
 * and its workspaces come from the same list as the switcher, so a new one
 * appears here without anyone remembering this page.
 */

/** What each workspace does, in a sentence a stranger can follow. */
const PITCH: Partial<Record<ModuleId, string>> = {
  shopping:
    'Order confirmations from your inbox become a list of what you own, and a monthly total of what you spent net of refunds.',
  jobs: 'Every application from first lead to offer on one board, with the roles, companies, interviews and an answer bank behind it.',
  todo: 'One agenda for what has to happen, whichever workspace it came from.',
  vault: 'Your Obsidian notes, mirrored here and searchable beside everything else.',
  learn: 'Questions on what you are studying until you choose to stop, and a reading list to go with them.',
  news: 'Newsletters sent to an address of your own, read one story at a time.',
  goals: 'What you are working towards, broken into steps, with the next step on each goal in view.',
};

function hue(module: AppModule): CSSProperties {
  return { '--hue-from': module.key.from, '--hue-to': module.key.to } as CSSProperties;
}

export default function HomePage() {
  const workspaces = modulesFor(false);
  const byId = (id: ModuleId) => workspaces.find((module) => module.id === id)!;

  return (
    <div className={s.page}>
      <div className={s.stars} aria-hidden />
      <div className={s.sky} aria-hidden />
      <div className={s.rays} aria-hidden />

      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <ModuleMark module={null} size="md" />
          <span className={cn('text-body font-semibold tracking-tight whitespace-nowrap', s.ink)}>
            Personal Dashboard
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/login" className={cn(s.quiet, 'px-3 py-2 text-ui')}>
            Sign in
          </Link>
          <Link href="/signup" className={cn(s.primary, 'px-4 py-2 text-ui')}>
            Get started
          </Link>
        </nav>
      </header>

      <main>
        {/* ---- Hero ---- */}
        <section className="mx-auto max-w-6xl px-4 pt-16 text-center sm:px-6 sm:pt-24">
          <div className={s.rise}>
            <span className={cn(s.eyebrow, 'text-small')}>
              <span className={s.eyebrowDot}>{workspaces.length}</span>
              workspaces and an assistant, in one account
            </span>
          </div>

          <h1
            className={cn(
              s.rise,
              s.ink,
              'font-display mx-auto mt-7 max-w-4xl text-figure font-semibold tracking-[-0.035em] sm:text-figure-lg lg:text-figure-xl',
            )}
            style={{ '--delay': '80ms' } as CSSProperties}
          >
            Your orders, job search, notes and goals,{' '}
            <span className={s.glow}>working as&nbsp;one.</span>
          </h1>

          <p
            className={cn(s.rise, s.muted, 'mx-auto mt-6 max-w-2xl text-body leading-relaxed')}
            style={{ '--delay': '160ms' } as CSSProperties}
          >
            Your inbox fills in your orders and interviews. Return deadlines, job reminders and goal
            steps land on one agenda. Goals tick themselves off when the work shows up elsewhere, and
            Dash, the assistant, can answer questions across all of it.
          </p>

          <div
            className={cn(s.rise, 'mt-9 flex flex-wrap items-center justify-center gap-3')}
            style={{ '--delay': '240ms' } as CSSProperties}
          >
            <Link href="/signup" className={cn(s.primary, 'px-6 py-3 text-body')}>
              Get started
              <span aria-hidden>→</span>
            </Link>
            <Link href="/privacy" className={cn(s.secondary, 'px-6 py-3 text-body')}>
              How we handle your email
            </Link>
          </div>

          {/* ---- The preview window ---- */}
          <div
            className={cn(s.rise, 'relative mx-auto mt-16 max-w-5xl sm:mt-20')}
            style={{ '--delay': '360ms' } as CSSProperties}
            aria-hidden
          >
            <div className={cn(s.glass, s.window, 'overflow-hidden text-left')}>
              <div className={cn(s.windowBar, 'flex items-center gap-1.5 px-4 py-3')}>
                <span className={s.windowDot} />
                <span className={s.windowDot} />
                <span className={s.windowDot} />
                <span className={cn(s.ghost, 'ml-3 text-small')}>Home</span>
              </div>

              <div className="flex">
                <aside className="hidden w-48 shrink-0 flex-col gap-0.5 p-3 md:flex">
                  {workspaces.map((module, index) => (
                    <div
                      key={module.id}
                      className={cn(
                        s.sideItem,
                        index === 0 && s.sideItemActive,
                        'flex items-center gap-2.5 px-2 py-1.5 text-ui',
                      )}
                    >
                      <ModuleMark module={module.id} size="xs" />
                      {module.label}
                    </div>
                  ))}
                </aside>

                <div className="min-w-0 flex-1 p-4 sm:p-6">
                  <p className={cn(s.ghost, 'text-small')}>Friday 3 October</p>
                  <p className={cn(s.ink, 'font-display mt-1 text-title font-semibold tracking-tight')}>
                    Good morning
                  </p>

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <PreviewTile module={byId('shopping')} label="Spent in September" figure="$412" fill={62} />
                    <PreviewTile module={byId('jobs')} label="Applications in play" figure="9" fill={45} />
                    <PreviewTile module={byId('goals')} label="Steps done this week" figure="6 of 8" fill={75} />
                  </div>

                  <p className={cn(s.ghost, 'mt-5 text-small')}>Today, from every workspace</p>
                  <div className={cn(s.well, 'mt-2 divide-y divide-white/5')}>
                    {[
                      { id: 'todo' as const, text: 'Send the portfolio link to Northwind', meta: 'Today' },
                      { id: 'jobs' as const, text: 'Second interview, product designer', meta: 'Tue 10:30' },
                      { id: 'learn' as const, text: '12 questions waiting on statistics', meta: 'Learn' },
                    ].map((row) => (
                      <div key={row.text} className="flex items-center gap-3 px-3 py-2.5">
                        <ModuleMark module={row.id} size="xs" />
                        <span className={cn(s.ink, 'min-w-0 flex-1 truncate text-ui')}>{row.text}</span>
                        <span className={cn(s.ghost, 'shrink-0 text-small')}>{row.meta}</span>
                      </div>
                    ))}
                  </div>

                  <div className={cn(s.ask, 'mt-4 flex items-center gap-2.5 px-3 py-2')}>
                    <ModuleMark module={null} size="xs" />
                    <span className={cn(s.ghost, 'text-ui')}>Ask Dash about anything in here</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <Connections byId={byId} />

        {/* ---- Workspaces ---- */}
        <section className="mx-auto max-w-6xl px-4 pt-28 sm:px-6 sm:pt-36">
          <div className="max-w-2xl">
            <p className={cn(s.hueText, 'text-small font-semibold tracking-wide uppercase')} style={hue(byId('jobs'))}>
              Workspaces
            </p>
            <h2 className={cn(s.ink, 'font-display mt-3 text-figure font-semibold tracking-[-0.03em]')}>
              A room for each part of your life.
            </h2>
            <p className={cn(s.muted, 'mt-4 text-body leading-relaxed')}>
              Turn on the workspaces you use and leave the rest off. They share one search, one
              agenda and one assistant, so a todo can come from an interview and a goal can draw on
              your notes.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((module, index) => (
              <article
                key={module.id}
                className={cn(
                  s.glass,
                  s.workspace,
                  'p-6',
                  // Seven in a grid of three would leave one alone on the last
                  // row, so the first and last run double width there. The last
                  // also closes the two-column grid.
                  index === 0 && 'lg:col-span-2',
                  index === workspaces.length - 1 && 'sm:col-span-2',
                )}
                style={hue(module)}
              >
                <div className="relative">
                  <ModuleMark module={module.id} size="lg" />
                  <h3 className={cn(s.ink, 'font-display mt-5 text-title font-semibold tracking-tight')}>
                    {module.label}
                  </h3>
                  <p className={cn(s.muted, 'mt-2 text-ui leading-relaxed')}>
                    {PITCH[module.id] ?? module.description}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ---- Dash ---- */}
        <section className="mx-auto max-w-6xl px-4 pt-28 sm:px-6 sm:pt-36">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className={cn(s.hueText, 'text-small font-semibold tracking-wide uppercase')} style={hue(byId('vault'))}>
                Dash
              </p>
              <h2 className={cn(s.ink, 'font-display mt-3 text-figure font-semibold tracking-[-0.03em]')}>
                Ask a question instead of opening five pages.
              </h2>
              <p className={cn(s.muted, 'mt-4 text-body leading-relaxed')}>
                Dash reads across every workspace you have turned on, and across Gmail when you
                connect it. Every answer links to the rows it came from, so you can check the
                working.
              </p>
            </div>

            <div className={cn(s.glass, s.window, 'p-5 sm:p-6')} aria-hidden>
              <div className="flex justify-end">
                <p className={cn(s.ink, 'max-w-sm rounded-2xl rounded-br-md bg-white/10 px-4 py-2.5 text-ui')}>
                  Which applications have gone quiet for more than two weeks?
                </p>
              </div>
              <div className="mt-4 flex gap-3">
                <ModuleMark module={null} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className={cn(s.muted, 'text-ui leading-relaxed')}>
                    Three. You last heard from each of these on the date shown.
                  </p>
                  <div className={cn(s.well, 'mt-3 divide-y divide-white/5')}>
                    {[
                      ['Senior analyst, Halden & Co', '14 Sep'],
                      ['Operations lead, Brightwater', '11 Sep'],
                      ['Product designer, Larkspur', '8 Sep'],
                    ].map(([role, date]) => (
                      <div key={role} className="flex items-center gap-3 px-3 py-2.5">
                        <ModuleMark module="jobs" size="xs" />
                        <span className={cn(s.ink, 'min-w-0 flex-1 truncate text-ui')}>{role}</span>
                        <span className={cn(s.ghost, 'shrink-0 text-small')}>{date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/*
          The job search half is stated here on purpose. This page and the
          privacy policy are read together during Google's brand verification,
          and the policy describes storing job descriptions and contact details
          -- which reads as a discrepancy if the homepage never mentions them.
        */}
        <section className="mx-auto max-w-6xl px-4 pt-28 sm:px-6 sm:pt-36">
          <div className="max-w-2xl">
            <p className={cn(s.hueText, 'text-small font-semibold tracking-wide uppercase')} style={hue(byId('todo'))}>
              Your data
            </p>
            <h2 className={cn(s.ink, 'font-display mt-3 text-figure font-semibold tracking-[-0.03em]')}>
              What the app reads, and what it keeps.
            </h2>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <div className={cn(s.glass, 'p-6')}>
              <h3 className={cn(s.ink, 'text-body font-semibold')}>Read-only email</h3>
              <p className={cn(s.muted, 'mt-2 text-ui leading-relaxed')}>
                Connecting Gmail grants the read-only scope. The app can never send, change or delete
                anything in your mailbox.
              </p>
            </div>
            <div className={cn(s.glass, 'p-6')}>
              <h3 className={cn(s.ink, 'text-body font-semibold')}>Job postings kept in full</h3>
              <p className={cn(s.muted, 'mt-2 text-ui leading-relaxed')}>
                Postings are usually taken down before you need them again, so they are stored whole.
                Contacts hold the professional details you enter yourself and nothing more.
              </p>
            </div>
            <div className={cn(s.glass, 'p-6')}>
              <h3 className={cn(s.ink, 'text-body font-semibold')}>Set out in plain terms</h3>
              <p className={cn(s.muted, 'mt-2 text-ui leading-relaxed')}>
                The{' '}
                <Link href="/privacy" className={s.link}>
                  privacy policy
                </Link>{' '}
                lists every kind of data stored, what a language model reads, and how to delete it.
              </p>
            </div>
          </div>
        </section>

        {/* ---- Close ---- */}
        <section className="relative mt-28 overflow-hidden px-4 pt-20 pb-28 text-center sm:mt-36 sm:px-6">
          <div className={s.horizon} aria-hidden />
          <div className="mx-auto flex max-w-fit -space-x-1.5">
            {workspaces.map((module) => (
              <ModuleMark key={module.id} module={module.id} size="md" />
            ))}
          </div>
          <h2 className={cn(s.ink, 'font-display mx-auto mt-8 max-w-2xl text-figure font-semibold tracking-[-0.03em] sm:text-figure-lg')}>
            Start with the workspace you need most.
          </h2>
          <p className={cn(s.muted, 'mx-auto mt-4 max-w-xl text-body leading-relaxed')}>
            Sign up with Google or an email address. You can turn the others on later.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className={cn(s.primary, 'px-6 py-3 text-body')}>
              Get started
              <span aria-hidden>→</span>
            </Link>
            <Link href="/login" className={cn(s.secondary, 'px-6 py-3 text-body')}>
              Sign in
            </Link>
          </div>
        </section>
      </main>

      <footer className={s.divider}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-ui sm:px-6">
          <span className={cn(s.ghost, 'flex items-center gap-2')}>
            <ModuleMark module={null} size="xs" />
            Personal Dashboard
          </span>
          <nav className="flex gap-5">
            <Link href="/privacy" className={s.quiet}>
              Privacy
            </Link>
            <Link href="/terms" className={s.quiet}>
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** The three things the page claims come into the app from outside it. */
const SOURCES = [
  {
    icon: 'inbox',
    title: 'Your Gmail',
    body: 'Order confirmations and interview invites, read with read-only access.',
  },
  { icon: 'note', title: 'Your Obsidian vault', body: 'Every note, mirrored and searchable.' },
  {
    icon: 'paper',
    title: 'Your newsletter address',
    body: 'Issues from the newsletters you point at it.',
  },
] as const;

/** What the workspaces make together that none of them makes alone. */
const OUTCOMES: { id: ModuleId; title: string; body: string }[] = [
  {
    id: 'todo',
    title: 'One agenda',
    body: 'Job reminders, return deadlines and goal steps on a single list for the day.',
  },
  {
    id: 'goals',
    title: 'Goals that keep score',
    body: 'A step closes when Jobs, Todo or an email shows it has happened.',
  },
  {
    id: 'learn',
    title: 'Learning with a purpose',
    body: 'What you want to learn sits among your goals, with questions to practise it in Learn.',
  },
];

/** One interview, followed through four workspaces. */
const STORY: { id: ModuleId | null; title: string; body: string }[] = [
  {
    id: 'jobs',
    title: 'An interview invite arrives',
    body: 'Jobs adds the interview to its application, at the time written on the invite.',
  },
  {
    id: 'todo',
    title: 'Todo has it on the day',
    body: 'Reminders you set on the application appear on your agenda when they fall due.',
  },
  {
    id: 'goals',
    title: 'Goals ticks the step off',
    body: '"Get to a second interview" closes, with a note naming the email that showed it.',
  },
  {
    id: null,
    title: 'Dash knows about it',
    body: 'Ask what is on this week and the interview is in the answer, linked to the application.',
  },
];

function SourceIcon({ icon }: { icon: (typeof SOURCES)[number]['icon'] }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {icon === 'inbox' ? (
        <>
          <path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
          <path d="M4 13h4.5l1 2h5l1-2H20" />
        </>
      ) : icon === 'note' ? (
        <>
          <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M9 12h6M9 16h4" />
        </>
      ) : (
        <>
          <path d="M5 5h11v14H6a1 1 0 0 1-1-1z" />
          <path d="M16 9h3v9a1 1 0 0 1-1 1h-2" />
          <path d="M8 9h5M8 13h5" />
        </>
      )}
    </svg>
  );
}

function Connections({ byId }: { byId: (id: ModuleId) => AppModule }) {
  const workspaces = modulesFor(false);

  return (
    <section className="mx-auto max-w-6xl px-4 pt-28 sm:px-6 sm:pt-36">
      <div className="mx-auto max-w-2xl text-center">
        <p className={cn(s.hueText, 'text-small font-semibold tracking-wide uppercase')} style={hue(byId('goals'))}>
          How it fits together
        </p>
        <h2 className={cn(s.ink, 'font-display mt-3 text-figure font-semibold tracking-[-0.03em] sm:text-figure-lg')}>
          Each workspace feeds the others.
        </h2>
        <p className={cn(s.muted, 'mt-4 text-body leading-relaxed')}>
          Nothing has to be copied from one place to another. What arrives in your inbox, what you
          write down and what you finish reach every workspace that needs them.
        </p>
      </div>

      <div className={cn(s.flow, 'mt-14')}>
        <div className="flex flex-col gap-3">
          <p className={cn(s.ghost, 'text-small font-semibold tracking-wide uppercase')}>Comes in</p>
          {SOURCES.map((source) => (
            <div key={source.title} className={cn(s.glass, 'flex gap-3 p-4')}>
              <span className={s.sourceIcon}>
                <SourceIcon icon={source.icon} />
              </span>
              <div>
                <p className={cn(s.ink, 'text-ui font-semibold')}>{source.title}</p>
                <p className={cn(s.muted, 'mt-0.5 text-small leading-relaxed')}>{source.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className={s.wire} aria-hidden />

        <div className={cn(s.glass, s.window, s.hub, 'p-5')}>
          <p className={cn(s.ghost, 'text-small font-semibold tracking-wide uppercase')}>Your workspaces</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {workspaces.map((module, index) => (
              <div
                key={module.id}
                className={cn(
                  s.chip,
                  'flex items-center gap-2 px-2.5 py-2 text-ui',
                  index === workspaces.length - 1 && workspaces.length % 2 === 1 && 'col-span-2 justify-center',
                )}
                style={hue(module)}
              >
                <ModuleMark module={module.id} size="xs" />
                <span className={s.ink}>{module.label}</span>
              </div>
            ))}
          </div>
          <div className={cn(s.dashRow, 'mt-4 flex items-center gap-3 p-3')}>
            <ModuleMark module={null} size="sm" />
            <p className={cn(s.muted, 'text-small leading-relaxed')}>
              <span className={cn(s.ink, 'font-semibold')}>Dash</span> reads across all of them
              and links every answer to where it came from.
            </p>
          </div>
        </div>

        <div className={s.wire} aria-hidden />

        <div className="flex flex-col gap-3">
          <p className={cn(s.ghost, 'text-small font-semibold tracking-wide uppercase')}>Comes together</p>
          {OUTCOMES.map((outcome) => (
            <div key={outcome.title} className={cn(s.glass, 'flex gap-3 p-4')} style={hue(byId(outcome.id))}>
              <ModuleMark module={outcome.id} size="sm" />
              <div>
                <p className={cn(s.ink, 'text-ui font-semibold')}>{outcome.title}</p>
                <p className={cn(s.muted, 'mt-0.5 text-small leading-relaxed')}>{outcome.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={cn(s.glass, 'mt-16 p-6 sm:p-8')}>
        <p className={cn(s.ink, 'font-display text-title font-semibold tracking-tight')}>
          One interview, followed through four workspaces
        </p>
        <ol className={cn(s.story, 'mt-8 grid gap-8 md:grid-cols-4 md:gap-6')}>
          {STORY.map((step, index) => (
            <li key={step.title} className="relative">
              <div className="flex items-center gap-3">
                <span className={cn(s.stepNum, 'text-small font-semibold')}>{index + 1}</span>
                <ModuleMark module={step.id} size="sm" />
              </div>
              <p className={cn(s.ink, 'mt-4 text-ui font-semibold')}>{step.title}</p>
              <p className={cn(s.muted, 'mt-1 text-small leading-relaxed')}>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function PreviewTile({
  module,
  label,
  figure,
  fill,
}: {
  module: AppModule;
  label: string;
  figure: string;
  fill: number;
}) {
  return (
    <div className={cn(s.well, 'p-4')} style={hue(module)}>
      <div className="flex items-center gap-2">
        <ModuleMark module={module.id} size="xs" />
        <span className={cn(s.muted, 'text-small')}>{label}</span>
      </div>
      <p className={cn(s.ink, 'font-display mt-3 text-figure font-semibold tracking-tight')}>{figure}</p>
      <div className={cn(s.bar, 'mt-3')}>
        <div className={s.barFill} style={{ width: `${fill}%` }} />
      </div>
    </div>
  );
}
