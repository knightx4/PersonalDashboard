import type { DashProposer, DashWriter } from '@/lib/dash/loop';

/**
 * The writes of a Dash quality case put to a People bot, rehearsed and never
 * made. A case asks whether the bot reached the right tool, the way a text
 * would (plan: tool areas, lib/dash/tool-areas.ts): "move my step to
 * Friday" should open goals and call change_goal_step. The tool is not run,
 * so nothing in the person's rows changes, and the model is told it was
 * done, so the reply goes on as it would.
 */
export const rehearseWrite: DashWriter = async (tool) => ({
  ok: true,
  rows: [],
  note: `Done (${tool.name}).`,
});

/** A proposal in the same case, kept nowhere. */
export const rehearseProposal: DashProposer = async (name) => ({
  ok: true,
  rows: [],
  note: `Proposed (${name}); it waits for their approval.`,
});
