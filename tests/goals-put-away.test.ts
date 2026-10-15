import { beforeEach, describe, expect, it, vi } from 'vitest';

const archiveGoalAction = vi.fn();
const settleGoalAction = vi.fn();
vi.mock('@/app/goals/actions', () => ({ archiveGoalAction, settleGoalAction }));

const { archiveConfirm, bringBackGoals, putAwayGoals, putAwayText } =
  await import('@/app/goals/put-away');

function sent(mock: ReturnType<typeof vi.fn>, call: number, form = 0): Record<string, string> {
  return Object.fromEntries((mock.mock.calls[call][form] as FormData).entries()) as Record<
    string,
    string
  >;
}

describe('putting goals away (plan #2097.1)', () => {
  beforeEach(() => {
    archiveGoalAction.mockReset().mockResolvedValue({ done: 1 });
    settleGoalAction.mockReset().mockResolvedValue({ done: 1 });
  });

  it('parks with the move Today makes, and takes it back up on undo', async () => {
    expect(await putAwayGoals(['g1'], 'park')).toEqual({ done: ['g1'] });
    expect(sent(settleGoalAction, 0, 1)).toEqual({ id: 'g1', move: 'park' });
    await bringBackGoals(['g1'], 'park');
    expect(sent(settleGoalAction, 1, 1)).toEqual({ id: 'g1', move: 'reopen' });
    expect(archiveGoalAction).not.toHaveBeenCalled();
  });

  it('archives, and restores on undo', async () => {
    await putAwayGoals(['g1'], 'archive');
    expect(sent(archiveGoalAction, 0)).toEqual({ id: 'g1' });
    await bringBackGoals(['g1'], 'archive');
    expect(sent(archiveGoalAction, 1)).toEqual({ id: 'g1', restore: 'true' });
  });

  it('stops at the first refusal and reports the goals already put away', async () => {
    archiveGoalAction
      .mockResolvedValueOnce({ done: 1 })
      .mockResolvedValueOnce({ error: 'That goal has already changed. Reload to see it.' });
    expect(await putAwayGoals(['g1', 'g2', 'g3'], 'archive')).toEqual({
      done: ['g1'],
      error: 'That goal has already changed. Reload to see it.',
    });
    expect(archiveGoalAction).toHaveBeenCalledTimes(2);
  });

  it('throws when the undo is refused, so the toast says it could not', async () => {
    settleGoalAction.mockResolvedValueOnce({ error: 'no' });
    await expect(bringBackGoals(['g1'], 'park')).rejects.toThrow('no');
  });

  it('says where the goal went, and counts several', () => {
    expect(putAwayText(1, 'park')).toBe('Parked. It is under Everything.');
    expect(putAwayText(1, 'archive')).toBe('Archived. It is under Everything.');
    expect(putAwayText(3, 'park')).toBe('Parked 3 goals. See Everything.');
  });

  it('names the steps that go with an archived goal', () => {
    expect(archiveConfirm(0)).toBe('Archive this goal? It has no steps yet.');
    expect(archiveConfirm(1)).toBe(
      'Archive this goal and its 1 step? They come back if you restore it.',
    );
    expect(archiveConfirm(7)).toContain('its 7 steps');
  });
});

describe('putting several goals away at once (plan #2097.2)', () => {
  beforeEach(() => {
    archiveGoalAction.mockReset().mockResolvedValue({ done: 1 });
    settleGoalAction.mockReset().mockResolvedValue({ done: 1 });
  });

  it('parks only the open goals of a mixed selection', async () => {
    const { parkable } = await import('@/app/goals/select-goals');
    const goals = [
      { id: 'a', status: 'open' as const },
      { id: 'b', status: 'proposed' as const },
      { id: 'c', status: 'open' as const, archivedAt: '2026-10-01T00:00:00Z' },
      { id: 'd', status: 'open' as const },
    ];
    expect(parkable(goals).map((goal) => goal.id)).toEqual(['a', 'd']);
  });

  it('writes every goal, and one undo brings every one back', async () => {
    const ids = ['g1', 'g2', 'g3'];
    expect(await putAwayGoals(ids, 'archive')).toEqual({ done: ids });
    expect(archiveGoalAction).toHaveBeenCalledTimes(3);
    await bringBackGoals(ids, 'archive');
    expect([3, 4, 5].map((call) => sent(archiveGoalAction, call))).toEqual(
      ids.map((id) => ({ id, restore: 'true' })),
    );
  });

  it('asks before archiving more than five', async () => {
    const { ARCHIVE_CONFIRM_OVER, archiveManyConfirm } = await import('@/app/goals/select-goals');
    expect(ARCHIVE_CONFIRM_OVER).toBe(5);
    expect(archiveManyConfirm(6)).toBe('Archive 6 goals and their steps?');
  });
});
