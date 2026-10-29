'use client';

import { AnswerSkeleton } from '@/app/you/answer/answer-skeleton';
import { AnswerView, type AnswerActions, type AnswerOpen } from '@/app/you/answer/answer-view';
import type { DashQuestion } from '@/lib/you/dash-questions';

/**
 * The Answer tab in the gallery (plan #2617.2): three questions waiting,
 * four answered, two skipped, and each hidden part drawn open. The fixtures
 * run as long as Dash's questions and a considered answer get.
 */

const actions: AnswerActions = {
  answer: async () => ({ ok: true }),
  skip: async () => ({ ok: true }),
  edit: async () => ({ ok: true }),
};

function question(
  n: number,
  fields: Pick<DashQuestion, 'question' | 'why' | 'status'> & Partial<DashQuestion>,
): DashQuestion {
  return {
    id: `00000000-0000-4000-8000-0000000026${String(n).padStart(2, '0')}`,
    answer: null,
    answeredAt: null,
    skippedAt: null,
    createdAt: '2026-10-20T09:00:00Z',
    updatedAt: '2026-10-20T09:00:00Z',
    ...fields,
  };
}

const open: DashQuestion[] = [
  question(1, {
    status: 'open',
    question: 'When a week goes well, what usually happened on the Monday?',
    why: 'Your daily notes rate some weeks far higher than others, and the good ones seem to start differently.',
  }),
  question(2, {
    status: 'open',
    question:
      'You have applied to three companies that build tools for teachers. Is education the field you want to stay in, or is it the kind of product you like making?',
    why: 'Your goals say "find a product role" without a field, and the roles you save point both ways.',
  }),
  question(3, {
    status: 'open',
    question: 'Who do you ask when you are stuck on a decision?',
    why: null,
  }),
];

const answered: DashQuestion[] = [
  question(11, {
    status: 'answered',
    question: 'What does a good Saturday look like for you?',
    why: null,
    answer:
      'A long run in the morning, then the farmers market, then nothing planned until dinner with friends.',
    answeredAt: '2026-10-24T18:20:00Z',
  }),
  question(12, {
    status: 'answered',
    question: 'Which of your side projects would you pick up again if you had a free month?',
    why: 'Three projects in your vault stopped within a week of each other.',
    answer:
      'The board game rules. I stopped because I could not get the second playtest together, not because I lost interest, and I still think about the scoring problem most weeks. The recipe site was mostly about learning the framework, and I learned it.',
    answeredAt: '2026-10-22T08:05:00Z',
  }),
  question(13, {
    status: 'answered',
    question: 'How much notice do you need before a trip to enjoy it?',
    why: null,
    answer: 'Two weeks.',
    answeredAt: '2026-10-21T12:00:00Z',
  }),
  question(14, {
    status: 'answered',
    question: 'What would make you leave a job you otherwise liked?',
    why: null,
    answer:
      'A manager who takes credit for the team’s work, or being asked to stop writing code entirely.',
    answeredAt: '2026-10-19T21:40:00Z',
  }),
];

const skipped: DashQuestion[] = [
  question(21, {
    status: 'skipped',
    question: 'What did you want to be when you were twelve?',
    why: null,
    skippedAt: '2026-10-23T10:00:00Z',
  }),
  question(22, {
    status: 'skipped',
    question: 'How do you feel about the move to the new flat now that it is three months on?',
    why: 'Your notes about the flat stopped in July.',
    skippedAt: '2026-10-18T10:00:00Z',
  }),
];

const past = [...answered, ...skipped];

/**
 * Which hidden part to draw, by name: the gallery's list is a server module,
 * and an id exported from this client one would reach it as a reference.
 */
export type AnswerPart = 'edit' | 'skipped' | 'error';

function partOpen(part: AnswerPart | undefined): AnswerOpen {
  if (part === 'edit') return { editing: answered[0].id };
  if (part === 'skipped') return { skipped: true, answering: skipped[0].id };
  if (part === 'error') {
    return {
      error: {
        id: open[0].id,
        message:
          'Saving your answer failed: the connection dropped. Your answer is still here; try again.',
        draft:
          'Usually I had planned the week on Sunday night and blocked the mornings for the hard work.',
      },
    };
  }
  return {};
}

export function YouAnswerPreview({
  part,
  empty = false,
  noneOpen = false,
}: {
  part?: AnswerPart;
  /** No questions at all: before Dash has asked any. */
  empty?: boolean;
  /** Nothing waiting, with answers below. */
  noneOpen?: boolean;
}) {
  return (
    <AnswerView
      open={empty || noneOpen ? [] : open}
      past={empty ? [] : past}
      timezone="Europe/Dublin"
      actions={actions}
      show={partOpen(part)}
    />
  );
}

export function YouAnswerLoadingPreview() {
  return <AnswerSkeleton />;
}
