'use client';

import { PageHeader } from '@/components/shell/page-header';
import { PageColumn } from '@/components/shell/page-width';
import { QuickRead, QuickReadEnd, type QuickReadActions } from '@/app/learn/b/[id]/quick/quick-read';
import { LearnNowFeed } from '@/app/learn/now/feed';
import type { FeedCard } from '@/lib/learn/feed/card';

/**
 * Gallery fixtures for a research brief's cards (plan #2023.6): the quick
 * read deck at /learn/b/<id>/quick, its empty and finished states, and a
 * card from a brief's source as Learn now deals it.
 */

const BRIEF_ID = '00000000-0000-4000-8000-00000000b001';
const QUESTION = 'How do SOX controls apply to AI used in financial reporting?';
const WHY = `For your research: ${QUESTION}`;

function researchCard(overrides: Partial<FeedCard> & Pick<FeedCard, 'id' | 'title'>): FeedCard {
  return {
    reason: 'researched',
    kind: 'research',
    briefId: BRIEF_ID,
    source: null,
    track: null,
    article: 'Staff statement on artificial intelligence in internal control over financial reporting',
    section: null,
    why: WHY,
    takeaway: null,
    context: null,
    hook: null,
    summary: '',
    example: null,
    question: null,
    answer: null,
    mentions: [],
    depth: null,
    difficulty: null,
    returning: null,
    shown: [],
    rest: [],
    restMinutes: 0,
    link: 'https://www.example-regulator.gov/statements/ai-icfr',
    site: 'example-regulator.gov',
    licence: null,
    ...overrides,
  };
}

export const briefCards: FeedCard[] = [
  researchCard({
    id: '00000000-0000-4000-8000-00000000c001',
    title: 'A model in a key control is part of the control',
    takeaway:
      'When an AI model performs or supports a key control, auditors test the model the way they would test the control itself.',
    context:
      'A key control is a check a company relies on to stop a material error reaching its financial statements. Under the Sarbanes-Oxley Act, management has to say each year whether those checks worked.',
    hook: 'The statement says a company should be able to show how the model was tested, what data it was trained on, and who reviews what it flags.',
    summary:
      'An auditor can only rely on a control whose working can be shown. A model that decides which journal entries get a second look is making the control’s decision, so evidence about the model is evidence about the control.',
    example:
      'A company that uses a model to flag unusual journal entries keeps a log of the entries it flagged, the reviewer who cleared each one, and the tests run on the model before the year began.',
    question:
      'A model that flags unusual invoices is retrained halfway through the year. What does the auditor need to see, and why?',
    answer:
      'Evidence that the retrained model was tested before use and that review continued throughout. The control changed partway, so both versions have to be shown to have worked.',
  }),
  researchCard({
    id: '00000000-0000-4000-8000-00000000c002',
    title: 'Reviewers have to own what the model decides',
    article: 'Generative AI and the audit: what firms are asking clients',
    link: 'https://www.example-firm.com/insights/genai-audit',
    site: 'example-firm.com',
    takeaway: 'A person reviewing a model’s output is only a control if they can say why each output is right.',
    context: 'Firms ask clients who reviews a model’s output and what that person checks before accepting it.',
    hook: 'One firm reports that most clients it surveyed could not say what their reviewers checked.',
    summary:
      'A review that accepts whatever the model says adds nothing an auditor can rely on. The review counts only when the reviewer checks the output against something they know independently.',
    example: null,
    question: 'Why is a sign-off on every model output not enough on its own?',
    answer: 'A sign-off shows someone looked, not that they checked. The auditor needs to see what the reviewer compared the output against.',
  }),
  researchCard({
    id: '00000000-0000-4000-8000-00000000c003',
    title: 'Change management covers retraining',
    article: 'IT general controls for machine learning systems',
    link: 'https://www.example-body.org/itgc-ml',
    site: 'example-body.org',
    takeaway: 'Retraining a model is a change to a system, and falls under the same change controls as a code release.',
    context: 'IT general controls are the checks over how systems are built, changed and run.',
    hook: 'The guide lists retraining, new training data and a changed threshold as changes that need approval.',
    summary:
      'A model that learns from new data behaves differently afterwards, as changed code does. If retraining skips approval, nothing shows the new behaviour was checked before it reached the books.',
  }),
];

const galleryActions: QuickReadActions = {
  dismiss: async () => ({}),
  open: async () => undefined,
};

const crumbs = [
  { label: 'Learn', href: '/learn' },
  { label: QUESTION, href: `/learn/b/${BRIEF_ID}` },
  { label: 'Quick read', href: `/learn/b/${BRIEF_ID}/quick` },
];

/** The quick read: the deck of the brief's cards, as the page draws it. */
export function BriefQuickPreview({ state }: { state: 'deck' | 'researching' | 'end' }) {
  return (
    <PageColumn className="max-w-2xl">
      <PageHeader crumbs={crumbs} title="Quick read" />
      {state === 'end' ? (
        <QuickReadEnd briefId={BRIEF_ID} />
      ) : (
        <QuickRead
          briefId={BRIEF_ID}
          status={state === 'researching' ? 'researching' : 'ready'}
          cards={state === 'researching' ? [] : briefCards}
          actions={galleryActions}
        />
      )}
    </PageColumn>
  );
}

/**
 * More than the deck preloads ahead of, so the gallery never asks the server
 * for more: the brief's three cards and two more behind them.
 */
const nowCards: FeedCard[] = [
  ...briefCards,
  ...briefCards.slice(0, 2).map((card, index) => ({ ...card, id: `00000000-0000-4000-8000-00000000c10${index}` })),
];

/** Learn now with a card from a brief's source on top. */
export function LearnNowResearchPreview() {
  return <LearnNowFeed first={nowCards} ready={12} low={10} />;
}

/**
 * Learn now with a card from a source a brief's weekly check found on top
 * (plan #2023.8): the card is marked as a new source until it is opened.
 */
export function LearnNowResearchNewPreview() {
  return (
    <LearnNowFeed
      first={nowCards.map((card, index) => (index === 0 ? { ...card, fresh: true } : card))}
      ready={12}
      low={10}
    />
  );
}
