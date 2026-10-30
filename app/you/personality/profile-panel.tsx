'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CardSection } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import Link, { linkVariants } from '@/components/ui/link';
import { Note } from '@/components/ui/note';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/goals/dates';
import { noteHref } from '@/lib/vault/paths';
import type { PersonalityProfile, ProfileState } from '@/lib/you/personality/profile';
import { writeProfileAction } from './actions';

/**
 * Dash's analysis across all your tests, at the top of the Personality tab:
 * a short summary, where the tests agree, where they disagree with what your
 * notes and record say about it, and the patterns worth watching with the
 * number behind each. The button to write it shows only when there is none
 * yet or a test was added, changed or deleted since the last one.
 */

const STATE_LINE: Partial<Record<ProfileState, string>> = {
  none: 'Keep a second test and Dash can read them together.',
  first: 'Dash can read all your tests together, against your notes and what you do.',
  changed: 'A test was added, changed or deleted since this was written.',
};

function Tests({ tests }: { tests: readonly string[] }) {
  if (tests.length === 0) return null;
  return <p className="mt-0.5 text-small text-ink-muted">{tests.join(' · ')}</p>;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-ui font-medium text-ink">{title}</h3>
      <ul className="mt-2 space-y-3">{children}</ul>
    </div>
  );
}

export function ProfilePanel({
  profile,
  state,
}: {
  profile: PersonalityProfile | null;
  state: ProfileState;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function write() {
    setError(null);
    startTransition(async () => {
      const outcome = await writeProfileAction();
      if ('error' in outcome) setError(outcome.error);
      router.refresh();
    });
  }

  const offer = state === 'first' || state === 'changed';
  const line = STATE_LINE[state];

  return (
    <CardSection
      title="Across your tests"
      meta={profile ? `Written ${formatDay(profile.createdAt.slice(0, 10), true)}` : undefined}
      padding="standard"
      fold="you.personality.across"
      action={
        offer ? (
          <DashAction
            variant="secondary"
            size="sm"
            onClick={write}
            pending={pending}
            paid="app/you/personality/actions.ts#writeProfileAction"
            what="Cost of Dash reading all your tests together"
          >
            {pending ? 'Reading…' : profile ? 'Read them again' : 'Read them together'}
          </DashAction>
        ) : undefined
      }
    >
      <div className="space-y-5">
        {line || error ? (
          <p className={cn('text-ui', error ? 'text-danger' : 'text-ink-muted')}>{error ?? line}</p>
        ) : null}

        {profile ? (
          <>
            <Note>
              <p className="text-body text-ink">{profile.summary}</p>
            </Note>

            {profile.agreements.length > 0 ? (
              <Group title="Where they agree">
                {profile.agreements.map((a, i) => (
                  <li key={i}>
                    <p className="text-body text-ink">{a.text}</p>
                    <Tests tests={a.tests} />
                  </li>
                ))}
              </Group>
            ) : null}

            {profile.tensions.length > 0 ? (
              <Group title="Where they disagree">
                {profile.tensions.map((t, i) => (
                  <li key={i}>
                    <p className="text-body text-ink">{t.text}</p>
                    <p className="mt-1 text-ui text-ink">
                      <span className="text-ink-muted">What your notes and record say · </span>
                      {t.verdict}
                    </p>
                    {t.note ? (
                      <p className="mt-0.5 text-small text-ink-muted">
                        From{' '}
                        <Link
                          href={noteHref(t.note.path)}
                          className={cn('break-words', linkVariants({ tone: 'quiet' }))}
                        >
                          {t.note.title}
                        </Link>
                      </p>
                    ) : null}
                    <Tests tests={t.tests} />
                  </li>
                ))}
              </Group>
            ) : null}

            {profile.watch.length > 0 ? (
              <Group title="Worth watching">
                {profile.watch.map((w, i) => (
                  <li key={i}>
                    <p className="text-body text-ink">{w.text}</p>
                    <p className="mt-0.5 text-small tabular-nums text-ink-muted">{w.evidence}</p>
                  </li>
                ))}
              </Group>
            ) : null}
          </>
        ) : null}
      </div>
    </CardSection>
  );
}
