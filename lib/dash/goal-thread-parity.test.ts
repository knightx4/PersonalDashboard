import { describe, expect, it } from 'vitest';
import { GOAL_THREAD_TABLE, THREAD_TOOLS } from './thread-tools';
import { WRITE_TOOLS } from './writes';

/**
 * Whatever a comment on a goal can ask Dash to do, Ask Dash can do too. Each
 * tool a goal's thread offers names the Ask tool that makes the same change,
 * on the goal or step named by its ref rather than the row the comment hangs
 * from. A new goal-thread tool fails here until Ask has its equivalent.
 */
const ASK_EQUIVALENT: Record<string, string> = {
  file_goal_record: 'change_goal_form',
  schedule_goal_step: 'change_goal_step',
  move_goal_step: 'change_goal_step',
  archive_goal_step: 'change_goal_step',
  promote_step_to_errand: 'change_goal_step',
  approve_goal: 'change_goal',
  start_errand_run: 'start_goal_run',
  take_step: 'work_goal_step',
  pass_to_routine: 'start_goal_run',
};

describe("a goal thread's tools", () => {
  const goalThreadTools = THREAD_TOOLS.filter((tool) => tool.subjects?.includes(GOAL_THREAD_TABLE)).map((tool) => tool.name);

  it('each have an equivalent in Ask', () => {
    expect([...goalThreadTools].sort()).toEqual(Object.keys(ASK_EQUIVALENT).sort());
  });

  it('name Ask tools that exist and are offered in Ask, not only in a thread', () => {
    const ask = new Map(WRITE_TOOLS.map((tool) => [tool.name, tool]));
    for (const [threadTool, askTool] of Object.entries(ASK_EQUIVALENT)) {
      const found = ask.get(askTool);
      expect(found, `${threadTool} names ${askTool}`).toBeDefined();
      expect(found?.subjects, `${askTool} is offered in Ask`).toBeUndefined();
    }
  });
});
