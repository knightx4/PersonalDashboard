/**
 * The shapes the shared tree components take (plan #995).
 *
 * The dev plan's `PlanNode` fits each of these as it is. A page with steps of
 * its own -- a goal's -- builds the same fields and hands over its own server
 * actions, and the rows read the same on both.
 */
import type { CommentStore, ThreadTarget } from '@/components/dev/comment-thread';
import type { DevComment } from '@/lib/comments/load';
import type { PlanKind, PlanStatus } from '@/lib/plan/load';

/** What a server action hands back to the form that ran it. */
export type TreeActionState = { error?: string; message?: string };

/** A server action as `useActionState` takes it. */
export type TreeAction = (state: TreeActionState, formData: FormData) => Promise<TreeActionState>;

/**
 * The writes the shared components make. Each posts the same form fields the
 * dev plan's actions read, so another page's actions read those names too:
 *
 * - `answer`: `id`, `resolution`
 * - `setStatus`: `id`, `status`
 * - `dismissQuestion`: `id`, `dismissed` ("1" or "0")
 * - `ask`: `module`, `parent`, `kind` ("decision"), `title`
 * - `addDependency`: `item`, `depends_on`
 * - `removeDependency`: `id`, the dependency row's own id
 */
export type TreeActions = {
  answer: TreeAction;
  setStatus: TreeAction;
  dismissQuestion: TreeAction;
  ask: TreeAction;
  addDependency: TreeAction;
  removeDependency: TreeAction;
};

/** Where a row's comments are written. The dev plan's are steps in `dev_comments`. */
export type TreeComments = { target: ThreadTarget; store?: CommentStore };

export const PLAN_COMMENTS: TreeComments = { target: 'step' };

/** A question beneath a step: a decision, closed by an answer. */
export type TreeQuestion = {
  id: string;
  number: number;
  outline: string;
  title: string;
  detail: string | null;
  resolution: string | null;
  status: PlanStatus;
  kind: PlanKind;
  dismissedAt: string | null;
  thread: DevComment[];
};

/** A step that questions hang off. Only the children that are decisions are read. */
export type TreeQuestionHolder = {
  id: string;
  module: string | null;
  status: PlanStatus;
  children: readonly TreeQuestion[];
};

/** Another step, as a dependency chip names it. */
export type TreeStepRef = { id: string; number: number; title: string; status: PlanStatus };

/** A step's dependencies, both ways. */
export type TreeDependencyNode = {
  id: string;
  /** The steps this one is declared to wait on, with the row each edge is stored as. */
  dependsOn: readonly { dependencyId: string; item: TreeStepRef }[];
  /** What holds it up, its own edges and those of every step above it. */
  waitingOn: readonly Omit<TreeStepRef, 'status'>[];
  /** The steps declared to wait on this one. */
  blocks: readonly Omit<TreeStepRef, 'status'>[];
};

/** A step the dependency picker offers. */
export type TreeCatalogEntry = {
  id: string;
  number: number;
  title: string;
  parentId: string | null;
  depth: number;
  closed: boolean;
};
