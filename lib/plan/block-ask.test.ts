import { describe, expect, it } from 'vitest';
import { blockAskNamesBranch, blockAskRefusal, blockAskSaysNothingNeeded } from './block-ask';

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

describe('a block that names a git branch', () => {
  it.each([
    'Built on branch worktree-agent-a1cc2d05, not on main, so those links show the old page. Accept it?',
    'The work is on branch claude/brave-lovelace-zf0z8d. Accept it as it is, or say what to change.',
    'Open the branch and say whether the card reads right.',
    'Check the preview of claude/contact-card and pick a layout.',
    'Merge the branch as it is, or say what to change?',
  ])('is refused, pointing at pictures: %s', (ask) => {
    expect(blockAskNamesBranch(ask)).toBe(true);
    const refusal = blockAskRefusal(ask, false);
    expect(refusal).toContain('cannot open branches');
    expect(refusal).toContain('/preview?s=<id>');
    expect(refusal).toContain('shots on the step');
    expect(refusal).toContain('--note');
  });

  it('is refused on a block that waits on steps too, since the ask is still shown', () => {
    expect(blockAskRefusal('Waits on #12; the work is on branch claude/x.', true)).toContain('cannot open branches');
  });

  it.each([
    'Accept the account page as drawn at /preview?s=account-home, or say what to change.',
    'Look at the shots on the row in /dev/plan, then accept it or say what to change.',
    'Which of the two layouts on #1688, the list or the grid?',
  ])('is allowed when it points at pictures: %s', (ask) => {
    expect(blockAskNamesBranch(ask)).toBe(false);
    expect(blockAskRefusal(ask, false)).toBeNull();
  });
});
