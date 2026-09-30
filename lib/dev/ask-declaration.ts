import type { AskDeclaration } from '@/lib/ask/declaration';

export const devAsk: AskDeclaration = {
  module: 'dev',
  is: 'The app looking at itself.',
  holds: ['the build plan and its steps', 'ideas', 'bug reports and feature requests', 'raised questions'],
  readWith: ['search', 'open_row'],
};
