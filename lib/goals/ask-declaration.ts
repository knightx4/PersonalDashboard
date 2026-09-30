import type { AskDeclaration } from '@/lib/ask/declaration';

export const goalsAsk: AskDeclaration = {
  module: 'goals',
  is: 'What the person is working towards.',
  holds: ['areas, goals and the steps under them', 'the daily review of each goal: on track, stalled or waiting, with the next move'],
  readWith: ['goal_status', 'search', 'open_row'],
};
