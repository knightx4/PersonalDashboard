/**
 * A refusal from a Goals write that the model reads and says in words
 * (lib/dash/goals-writes.ts). In its own file so the writes kept beside it,
 * such as change_goal_list (lib/dash/goal-lists-writes.ts), can throw it
 * without importing goals-writes back.
 */
export class GoalsRefused extends Error {}
