import type Anthropic from '@anthropic-ai/sdk';
import { DASH_MODELS } from '@/lib/dash/models';
import type { DashVoice } from '@/lib/dash/loop';
import type { DashTool } from '@/lib/dash/registry';

/**
 * Maya as one of Dash's voices (plan #1479; docs/CORE-AND-DASH-SPEC.md,
 * decision 2). Maya's thoughts on a note and its replies in the note's thread
 * run on the shared loop in lib/dash/loop.ts, as every other Dash surface
 * does. What makes them Maya's is this setting: Opus, web search for a
 * source's exact words, and Maya's own rules, which the thought and the reply
 * each hand in.
 */

/**
 * Searches are for a source's exact wording; the sources themselves come from
 * what the model already knows. Each result is read back as input on every
 * later round, so this was cut from 5 on 30 September 2026.
 */
export const MAX_SEARCHES = 2;

/** Anthropic's web search, run on their side, at most MAX_SEARCHES times a turn. */
export const MAYA_WEB_SEARCH = {
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: MAX_SEARCHES,
} as unknown as Anthropic.ToolUnion;

/** The model Maya speaks with, for its thoughts and its replies. */
export const MAYA_MODEL = DASH_MODELS.maya;

/** How Maya speaks: its model and web search, with the rules, tools and ending the caller gives. */
export function mayaVoice(input: {
  system: string;
  tools: readonly DashTool[];
  finish: Anthropic.Tool;
  maxTokens?: number;
}): DashVoice {
  return {
    model: MAYA_MODEL,
    system: input.system,
    tools: input.tools,
    serverTools: [MAYA_WEB_SEARCH],
    finish: input.finish,
    ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
  };
}
