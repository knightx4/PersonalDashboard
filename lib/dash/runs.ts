/**
 * Which button each free Dash write tool matches (plan #2473.1, feature
 * #2473).
 *
 * A write tool that does what a button on a page does should do it by calling
 * the same function the button's server action calls, so the two cannot
 * drift: a rule added to the button reaches Dash the day it is written. Each
 * write tool says which buttons it matches, or why no page offers what it
 * does, and lib/dash/runs.test.ts follows the tool and each button through
 * the code (lib/core/spend/action-graph.ts) to check both reach the function
 * named. The paid tools say the same with their own `runs`
 * (lib/core/spend/paid-actions.test.ts).
 *
 * The pairs that do not yet hold are listed in lib/dash/runs-drift.ts, which
 * may only get shorter.
 */

/**
 * One button the tool matches: the server action the button calls and the
 * function both should reach, each as `file#export` from the repository root.
 * Where the button does its work inside the action itself, `calls` is the
 * action, and the pair cannot hold until that work moves into a function the
 * tool can call too.
 */
export type DashButtonMatch = {
  action: string;
  calls: string;
};

export type DashWriteRuns =
  | {
      buttons: readonly DashButtonMatch[];
      /**
       * For a tool whose `apply` only hands the call to its thread or the
       * capture box (lib/dash/thread-tools.ts, lib/dash/capture-tools.ts):
       * the function, as `file#export`, that carries it out there. The test
       * walks from it, since the walk cannot follow `ctx.thread`.
       */
      via?: string;
    }
  | {
      /** Why no button does what this tool does, in a sentence. */
      none: string;
    };

/** Matches these buttons, each as `[the button's server action, the function both should call]`. */
export function sameAs(...pairs: (readonly [action: string, calls: string])[]): DashWriteRuns {
  return { buttons: pairs.map(([action, calls]) => ({ action, calls })) };
}

/** Matches these buttons, carried out in a thread or the capture box by `via`. */
export function sameAsVia(via: string, ...pairs: (readonly [action: string, calls: string])[]): DashWriteRuns {
  return { buttons: pairs.map(([action, calls]) => ({ action, calls })), via };
}

/** No page offers what this tool does, for this reason. */
export function noButton(reason: string): DashWriteRuns {
  return { none: reason };
}
