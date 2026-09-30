import type { AskDeclaration } from '@/lib/ask/declaration';

export const todoAsk: AskDeclaration = {
  module: 'todo',
  is: 'What the person has to do.',
  holds: ['tasks with due dates, finished and open'],
  readWith: ['todos', 'search', 'open_row'],
  whenEmpty: {
    todos: 'Nothing finished or overdue in that period. Widen it, or find a named task with search.',
  },
};
