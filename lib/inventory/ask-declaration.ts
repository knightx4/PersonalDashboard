import type { AskDeclaration } from '@/lib/ask/declaration';

export const shoppingAsk: AskDeclaration = {
  module: 'shopping',
  is: 'What the person buys and owns.',
  holds: ['orders read from their email receipts', 'items they own', 'items they have saved', 'returns and resale'],
  readWith: ['spend_by_merchant', 'search', 'open_row'],
  whenEmpty: {
    spend_by_merchant:
      'No orders in that period or for that merchant. Widen the dates, or try part of the merchant name.',
  },
};
