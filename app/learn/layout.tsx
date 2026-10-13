import type { NavSection } from '@/components/shell/app-shell';
import { loadLearnBrief } from '@/lib/shell/brief';
import { shellFor } from '@/lib/shell/shell-for';
import { createLearnClient } from '@/lib/learn/auth/server';
import { countReadNow } from '@/lib/learn/tracks/load';

/**
 * Shell for the learn workspace.
 *
 * The proxy already blocks unauthenticated requests; the shell's loader
 * checks again, as a second line rather than the first.
 *
 * No onboarding gate, for the same reason the vault has none: nothing this
 * module does needs a Gmail grant, and bouncing somebody to a consent screen
 * because they pasted a reading list would be the wrong app answering.
 */
export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: 'learn',
    sections: async ({ owner }) =>
      learnSections(owner, await countReadNow(await createLearnClient())),
    brief: () => loadLearnBrief(),
    children,
  });
}

/**
 * Now first (plan #1486): the feed, with what is waiting in a strip at the
 * top and the practice questions behind its Practice only switch. Home and
 * Practice Flow were tabs of their own until then, and /learn/home and
 * /learn/flow redirect to Now. Then the subjects, then the rest. A subject,
 * a single idea and a quiz are reached through Subjects, and a reading list
 * and a reading through Reading lists, so they are `alsoMatches` rather
 * than tabs of their own -- a nav that grows an entry per depth level stops being
 * navigation.
 *
 * There is no Learn next tab. Its re-checks are asked in the practice
 * questions, its readings are on Now, and /learn/next redirects.
 */
function learnSections(owner: boolean, readNow: number): NavSection[] {
  return [
    // Learn now replaced the Read now tab (plan #805) and became Now (plan
    // #1486). The badge counts the readings you queued, which the feed shows
    // first, and not the cards it wrote: there are always about twenty of
    // those, and a number that never goes down is not information (plan #808).
    {
      href: '/learn/now',
      label: 'Now',
      icon: 'readNow',
      exact: true,
      badge: readNow,
    },
    // The subjects (plan #1487; the code still says subject, and the
    // database's `tracks` are reading lists). Quizzes are a section of this
    // page, so one quiz and the screen you answer it on light this tab too.
    {
      href: '/learn/know',
      label: 'Subjects',
      icon: 'know',
      exact: true,
      // Essays are reached from Subjects rather than a tab of their own,
      // since Learn keeps its tabs few (docs/CUT-BACK-SPEC.md, R1; plan #1865).
      alsoMatches: ['/learn/s/', '/learn/c/', '/learn/quiz', '/learn/essays', '/learn/e/'],
    },
    // Idea Space (plan #1857): every idea on one map, placed by what it says.
    // A tab of its own at the person's ask on 12 October 2026, which made it
    // Learn's fifth (docs/CUT-BACK-SPEC.md, R1).
    {
      href: '/learn/space',
      label: 'Idea Space',
      icon: 'ideaSpace',
      exact: true,
    },
    // No Goals tab (plan #1491): the learning goals are goals in the Learn
    // area on /goals, linked from Subjects, and /learn/goals redirects there.
    {
      href: '/learn/lists',
      label: 'Reading lists',
      icon: 'tracks',
      exact: true,
      alsoMatches: ['/learn/t/', '/learn/r/', '/learn/new'],
    },
    // Everything video on one page (plan #1488): your list (plan #1069), the
    // clips cut from it (plan #1400) and the YouTube library, which were three
    // tabs until then. /learn/clips and /learn/youtube redirect to their
    // sections, and a library channel, playlist or video lights this tab. The
    // owner's alone, because every transcript the library fetches spends the
    // owner's TranscriptAPI credits.
    ...(owner
      ? [
          {
            href: '/learn/videos',
            label: 'Videos',
            icon: 'videos' as const,
            exact: true,
            alsoMatches: ['/learn/videos/', '/learn/clips', '/learn/youtube'],
          },
        ]
      : []),
  ];
}
