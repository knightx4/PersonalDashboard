import { MODELS } from '@/lib/core/models';

/**
 * The model each Dash surface answers with (plan #1464, feature #1462). The
 * ids themselves live in lib/core/models.ts; this names which entry each
 * surface reads.
 *
 * Every thread replies with Sonnet since they moved onto the shared loop
 * (plan #1465): a reply on a dev row or a goal was Haiku before, and now
 * looks things up and makes changes as Ask does, for about a cent more.
 */
export const DASH_MODELS = {
  ask: MODELS.dashAsk,
  devThread: MODELS.devCommentReply,
  goalThread: MODELS.goalCommentReply,
  roleThread: MODELS.roleCommentReply,
  rowThread: MODELS.rowCommentReply,
  capture: MODELS.goalCapture,
} as const;

export type DashSurfaceModel = keyof typeof DASH_MODELS;
