import type { AskDeclaration } from '@/lib/ask/declaration';

export const learnAsk: AskDeclaration = {
  module: 'learn',
  is: 'What the person is learning.',
  holds: ['readings', 'tracks and subjects', 'the concepts and questions they have worked through'],
  readWith: ['search', 'open_row'],
};
