import type { ModuleSources } from '@/lib/sources/types';

/**
 * You's tables (lib/sources/types.ts): what is true about the person. Each is
 * what they did or said about themselves, so each is a source Goals may read.
 */
export const youSources: ModuleSources = {
  sources: [
    {
      table: 'you.personality_results',
      module: 'You',
      holds: 'Personality tests they took or typed in, each with its date: Big Five scores, or a type such as INTJ or 5w4.',
      weight: 'record',
      search: ['test_name', 'typed_value', 'note', 'read_points'],
      title: 'test_name',
      href: () => '/you/personality',
      note: 'kind is big_five, mbti, enneagram or other. A big_five row has the five IPIP factor scores, 10 to 50 each (extraversion, agreeableness, conscientiousness, emotional_stability, intellect); the others have typed_value, the type as they typed it in from a test taken elsewhere. note is an optional line of their own about the result. A retake is a new row, so read the latest by taken_at. read_points is Dash\'s read of the result against their notes, once written.',
    },
  ],
  notSources: [],
};
