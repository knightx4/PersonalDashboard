import type { AskDeclaration } from '@/lib/ask/declaration';

export const newsAsk: AskDeclaration = {
  module: 'news',
  is: 'Newsletters sent to an address of the person\'s own.',
  holds: ['the stories in each issue'],
  readWith: ['search', 'open_row'],
};
