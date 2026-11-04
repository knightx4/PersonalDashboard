import type Anthropic from '@anthropic-ai/sdk';
import type { AskToolResult } from '@/lib/ask/db';
import { MODELS } from '@/lib/core/models';
import { costMicrosFor, totalMicros, type SpendReport } from '@/lib/core/spend/pricing';
import { MOCKUP_DRAWN, MOCKUP_TOOL, MOCKUP_TOOL_DEFINITION, parseMockup } from '@/lib/talk/mockup';
import type { DashLookupTool } from './registry';
export { THOUGHT_CALL, thoughtCall, turnThought, type DashThought } from '@/lib/talk/thought';
import {
  READ_CODE_DEFINITION,
  READ_CODE_TOOL,
  SEARCH_CODE_DEFINITION,
  SEARCH_CODE_TOOL,
  readCode,
  searchCode,
  type CodeDeps,
} from './think-code';

/**
 * "Think it through" on the Ask box (plan #2789.10): a question that needs
 * thought but no change to the code, such as a design idea, a career choice
 * or what an article means for the app, answered on Opus at high effort with
 * web search, the specs (read_spec, already one of Ask's lookups), read-only
 * code lookups through the GitHub API (./think-code.ts) and a quick mockup
 * drawn in a sandboxed frame (lib/talk/mockup.ts).
 *
 * The switch is per question and off by default; with it off, Ask is as it
 * was. The answer keeps one more tool call, `think_it_through`, holding the
 * model and what the answer cost, which the line under the answer reads.
 */

export const THINK_MODEL = MODELS.dashThink;
export const THINK_EFFORT = 'high' as const;
/** Searches one answer may make: enough to compare a few sources, each read again every round. */
export const THINK_MAX_SEARCHES = 5;
/**
 * Time spent looking before it must answer. Opus at high effort thinks for
 * tens of seconds a round; the route's maxDuration is 300, which leaves the
 * answer call and the writes inside it.
 */
export const THINK_TIME_BUDGET_MS = 150_000;
/** Output tokens for one call: the thinking comes out of the same allowance. */
export const THINK_MAX_TOKENS = 32_000;

/** Anthropic's web search, run on their side. */
export const THINK_WEB_SEARCH = {
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: THINK_MAX_SEARCHES,
} as unknown as Anthropic.ToolUnion;

/** The lookups a thought-through answer has on top of Ask's. */
export const THINK_TOOLS: readonly DashLookupTool[] = [
  { name: READ_CODE_TOOL, kind: 'lookup', definition: READ_CODE_DEFINITION, inAppOnly: true },
  { name: SEARCH_CODE_TOOL, kind: 'lookup', definition: SEARCH_CODE_DEFINITION, inAppOnly: true },
  { name: MOCKUP_TOOL, kind: 'lookup', definition: MOCKUP_TOOL_DEFINITION as Anthropic.Tool, inAppOnly: true },
];

const THINK_NAMES = new Set(THINK_TOOLS.map((tool) => tool.name));

export function isThinkTool(name: string): boolean {
  return THINK_NAMES.has(name);
}

/** Added after Ask's rules when the switch is on; where the two differ, these win. */
export const THINK_RULES = `THEY ASKED YOU TO THINK THIS THROUGH. These rules come after the ones above
and win where the two differ. The question needs thought rather than a
lookup or a change: a design idea for the app, a choice in their career or
life, what an article or a product means for what they are building.

- Take the time. Weigh the options against each other, name what each costs,
  and end with what you would do and why. Say plainly where you are unsure.
- You may search the web here, with web_search, for facts, prices, what a
  product does or what others found. Name each source you rely on.
- For a question about the app, read what is written before you reason:
  read_spec for the spec that covers it, search_code and read_code for how it
  is built now (read only, main as it is). Ground what you suggest in what
  you read, and name the files.
- Their own rows still come from the lookups above, and a change they ask
  for is still made with its tool.
- When a picture says it better than words, such as a layout or a screen in
  two states, draw it with show_mockup and say in a sentence what it shows.
- Write the answer as prose, with a list where it helps. The thread draws no
  headings, so open each part with its name in bold ("**The two ways.**")
  instead. It can be longer than a usual answer, but every paragraph earns
  its place.`;

/** What the thought-through answer cost, from the spend its calls reported; null when any call is unpriced. */
export function thoughtCost(reports: readonly SpendReport[]): number | null {
  if (reports.length === 0) return null;
  const { micros, unpriced } = totalMicros(reports.map((report) => costMicrosFor(report.model, report.usage)));
  return unpriced > 0 ? null : micros;
}

/** What a thought-through answer's own lookups need. */
export type ThinkDeps = CodeDeps & {
  /**
   * Whether this account may read the app's code: the owner's alone, as
   * Dev is (lib/ask/dev.ts devAccess). Absent: refused.
   */
  codeAccess?: () => Promise<{ ok: true } | { ok: false; error: string }>;
};

/** Runs one of THINK_TOOLS. */
export async function runThinkTool(name: string, input: unknown, deps: ThinkDeps): Promise<AskToolResult> {
  if (name === MOCKUP_TOOL) {
    const parsed = parseMockup(input);
    if (!parsed.ok) return parsed;
    return { ok: true, rows: [], note: MOCKUP_DRAWN, kept: { mockup: parsed.mockup } };
  }
  if (name === READ_CODE_TOOL || name === SEARCH_CODE_TOOL) {
    const access = deps.codeAccess ? await deps.codeAccess() : { ok: false as const, error: 'The code cannot be read from here.' };
    if (!access.ok) return access;
    return name === READ_CODE_TOOL ? readCode(input, deps) : searchCode(input, deps);
  }
  return { ok: false, error: `There is no lookup called ${name}.` };
}
