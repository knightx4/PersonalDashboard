import { describe, expect, it } from 'vitest';
import {
  blockAskIsDesignCheck,
  blockAskNamesBranch,
  blockAskRefusal,
  blockAskSaysNothingNeeded,
} from './block-ask';

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
    'Should the export include archived rows, or only the live ones?',
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
    'Pick the layout at /preview?s=account-home or the one at /preview?s=account-list.',
    'Which of the two layouts on #1688, the list or the grid?',
  ])('is allowed when it points at pictures: %s', (ask) => {
    expect(blockAskNamesBranch(ask)).toBe(false);
    expect(blockAskRefusal(ask, false)).toBeNull();
  });
});

describe('a block that puts a design check to the person', () => {
  it.each([
    "The design critic did not pass #1770's screen: Reading (learn-reading). Look at the shots, then accept it as it is, or say what to change.",
    'Accept the goal screens this step touches as unchanged?',
    'Accept the 37 other plan screens that share the changed row without a design check?',
    'Should this step also fix the four things the critic found on the new-quiz page?',
    'Accept the account page as drawn, or say what to change.',
  ])('is refused, pointing at the settle: %s', (ask) => {
    expect(blockAskIsDesignCheck(ask)).toBe(true);
    const refusal = blockAskRefusal(ask, false);
    expect(refusal).toContain('design check');
    expect(refusal).toContain('--settle');
  });

  it('is refused on a block that waits on steps too', () => {
    expect(blockAskRefusal('Accept the screens as they are once #12 closes?', true)).toContain('--settle');
  });

  it.each([
    'Which of the two layouts on #1688, the list or the grid?',
    'Set RESEND_API_KEY in Vercel, then say it is done.',
  ])('is not one: %s', (ask) => {
    expect(blockAskIsDesignCheck(ask)).toBe(false);
  });
});
