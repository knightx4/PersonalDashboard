import { MODELS } from '@/lib/core/models';

/**
 * The model each Dash surface answers with (plan #1464, feature #1462). The
 * ids themselves live in lib/core/models.ts; this names which entry each
 * surface reads.
 *
 * The threads still differ by the row they hang on: replies on dev rows and
 * goals are Haiku and replies on a role are Sonnet. Moving the first two to
 * Sonnet is #1465, when the threads run through the shared loop.
 */
export const DASH_MODELS = {
  ask: MODELS.dashAsk,
  devThread: MODELS.devCommentReply,
  goalThread: MODELS.goalCommentReply,
  roleThread: MODELS.roleCommentReply,
  capture: MODELS.goalCapture,
} as const;

export type DashSurfaceModel = keyof typeof DASH_MODELS;
