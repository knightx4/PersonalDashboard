import type { AskDeclaration } from '@/lib/ask/declaration';

export const vaultAsk: AskDeclaration = {
  module: 'vault',
  is: 'The person\'s Obsidian notes, mirrored here.',
  holds: [
    'everything they have written down about their own life, past and present: what happened to them and when, what they think, plan and want, and the people in their life',
    'notes on any subject, in their own words',
  ],
  readWith: ['vault_notes', 'search', 'open_row'],
  whenEmpty: {
    vault_notes:
      'No note matched. Notes are matched on meaning as well as words, so a question about a life event is worth asking again in other terms: the event itself, the place, the people, the year. Try a different wording, or a period with from and to, before saying the notes do not hold it.',
    search:
      'Search matches titles only. What a note says is found with vault_notes and a query.',
  },
};
