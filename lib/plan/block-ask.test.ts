import { describe, expect, it } from 'vitest';
import { blockAskRefusal, blockAskSaysNothingNeeded } from './block-ask';

describe('a block that asks nothing of the person', () => {
  it.each([
    'Nothing is needed from you; the nightly run will report tomorrow.',
    'Nothing needed from you, just waiting on the 02:00 run.',
    'No action required from you.',
    'Only waiting on the deploy to finish.',
    'You do not need to do anything until the scheduled run has fired.',
  ])('is refused: %s', (ask) => {
    expect(blockAskSaysNothingNeeded(ask)).toBe(true);
    const refusal = blockAskRefusal(ask, false);
    expect(refusal).toContain('check-back');
    expect(refusal).toContain('in progress');
  });

  it.each([
    'Which of the two layouts on #1688, the list or the grid?',
    'Set RESEND_API_KEY in Vercel, then say it is done.',
    'Accept the account page as drawn, or say what to change.',
  ])('is allowed when it names something the person does: %s', (ask) => {
    expect(blockAskRefusal(ask, false)).toBeNull();
  });

  it('is allowed when the block waits on steps, which show as what it waits on', () => {
    expect(blockAskRefusal('Nothing needed from you until #12 closes.', true)).toBeNull();
  });
});
