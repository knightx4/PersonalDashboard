import type Anthropic from '@anthropic-ai/sdk';
import type { DashTool } from '@/lib/dash/registry';

/**
 * The tools a People bot loads on demand, by area.
 *
 * A bot reply used to send all 165 of Ask Dash's tools, about 75,000 tokens,
 * with every text, a "how was your day?" too. Now it sends the everyday
 * tools in BOT_LOADED and one more, open_area. The rest are sent with
 * `defer_loading: true`, which keeps them out of the prompt, and calling
 * open_area with an area's key loads that area's tools by returning
 * `tool_reference` blocks (the API's tool search, with the search done
 * here). The loaded definitions are appended to the conversation, so the
 * cached prefix holds.
 *
 * A tool in neither list is never deferred, so a tool added to Ask Dash
 * reaches the bots loaded until it is given an area here.
 * tool-areas.test.ts holds every tool of PEOPLE_TOOLS to one place.
 */

/** One area a bot can open: its key, what it covers, and its tools by name. */
export type ToolArea = {
  key: string;
  /** What the area holds, in the words the bot reads in open_area's description. */
  about: string;
  tools: readonly string[];
};

/** The name of the tool that opens an area. */
export const OPEN_AREA_TOOL = 'open_area';

/**
 * The tools a bot always has: finding and reading the person's rows, a
 * chart or a card under the reply, and the writes bots made most in their
 * first week (core.dash_actions by advisor, 4 to 10 November 2026: plan
 * steps, quick notes and todos).
 */
export const BOT_LOADED: readonly string[] = [
  'search',
  'recall',
  'open_row',
  'list_rows',
  'query_rows',
  'table_info',
  'show_chart',
  'attach_saved',
  'add_todo',
  'add_quick_note',
  'add_plan_step',
  'add_idea',
  'save_about_me',
  'propose_delete',
];

export const TOOL_AREAS: readonly ToolArea[] = [
  {
    key: 'todo',
    about: 'todos, the agenda, the calendar and what is on a day',
    tools: [
      'todos',
      'agenda',
      'schedule',
      'change_todo',
      'close_todo',
      'edit_todo',
      'add_todo_item',
      'link_todo',
      'add_todos',
      'add_event',
      'change_event',
      'change_agenda_row',
    ],
  },
  {
    key: 'goals',
    about: 'goals, their areas and steps, measures, links, lists, dashboards and logged hours',
    tools: [
      'goal_status',
      'add_goal',
      'add_goal_step',
      'close_goal_step',
      'set_goal_done_when',
      'change_goal_area',
      'change_goal',
      'change_goal_step',
      'change_goal_number',
      'change_goal_link',
      'change_goal_form',
      'change_goals_inbox',
      'change_goal_list',
      'change_goal_dashboard',
      'log_hours',
      'start_goal_run',
      'work_goal_step',
      'take_on_for_goal',
    ],
  },
  {
    key: 'jobs',
    about: 'the job search: roles, companies, applications and their stages, reminders, Jobs review, leads and finding openings',
    tools: [
      'job_applications',
      'read_job_board',
      'add_role_note',
      'add_job_lead',
      'move_roles',
      'change_role',
      'change_application',
      'change_company',
      'add_company',
      'merge_roles',
      'change_reminder',
      'change_waiting',
      'change_role_email',
      'add_role_from_email',
      'review_application',
      'review_events',
      'review_emails',
      'change_search_aim',
      'add_discovered_company',
      'find_startups',
      'find_openings',
    ],
  },
  {
    key: 'job_material',
    about: 'application answers and questions, the evidence bank, resumes, cover letters and career goals',
    tools: [
      'application_answers',
      'duplicate_answers',
      'add_application_questions',
      'save_answer',
      'set_default_answer',
      'add_evidence',
      'add_resume_version',
      'attach_resume_pdf',
      'change_career_thought',
      'draft_answer',
      'draft_application_answers',
      'draft_cover_letter',
      'match_role_requirements',
      'read_resume_jobs',
    ],
  },
  {
    key: 'interviews',
    about: 'interviews, interviewers, rounds and prep notes, and job-search contacts and outreach',
    tools: [
      'change_interview',
      'change_interviewer',
      'change_interview_round',
      'add_interview_round',
      'link_round_email',
      'write_prep_note',
      'change_contact',
      'change_touch',
      'mark_suggestion_sent',
      'suggest_people',
    ],
  },
  {
    key: 'shopping',
    about: 'things they own, orders, returns, Shopping lists, saved items and price watches',
    tools: [
      'mark_returned',
      'change_items',
      'change_item',
      'item_lists',
      'add_items',
      'change_saved_item',
      'add_order',
      'order_item_tags',
      'review_orders',
      'return_window',
      'change_person',
      'price_items_for_sale',
      'stop_watch',
      'propose_watch',
    ],
  },
  {
    key: 'money',
    about: 'spending, accounts, balances and recurring payments',
    tools: ['spend_by_merchant', 'accounts', 'balance_history', 'change_recurring'],
  },
  {
    key: 'learn',
    about: 'Learn: reading lists, ideas, videos, research briefs, essays, subjects, plans and quizzes',
    tools: [
      'reading_list',
      'learning_covered',
      'change_reading',
      'add_learn_track',
      'add_track_reading',
      'reword_concept',
      'add_concept_note',
      'change_video',
      'research_topic',
      'add_to_brief',
      'attach_vault_note',
      'draft_topic',
      'make_learn_subject',
      'write_subject_curriculum',
      'add_plan_unit',
      'summarize_reading',
      'retry_research_brief',
      'write_quiz_questions',
    ],
  },
  {
    key: 'notes',
    about: 'the Obsidian vault: notes, quick notes, themes and Maya',
    tools: [
      'vault_notes',
      'note_positions',
      'write_vault_note',
      'edit_vault_note',
      'rename_vault_note',
      'file_quick_note',
      'rename_theme',
      'rename_maya_question',
      'ask_maya',
    ],
  },
  {
    key: 'you',
    about: 'their details, places lived, work and school, courses and transcripts, personality results, the year review, the council and who on People texts them',
    tools: [
      'courses',
      'add_place',
      'change_place',
      'save_job',
      'set_detail',
      'change_course',
      'save_transcript',
      'read_personality_again',
      'write_year_review',
      'ask_board',
      'set_reach_out',
    ],
  },
  {
    key: 'news',
    about: 'newsletters: unread issues, saved stories and newsletter picks',
    tools: ['mark_issue_unread', 'save_story', 'send_story_to_learn', 'make_todo_from_story', 'remake_newsletter_picks'],
  },
  {
    key: 'mail_places',
    about: 'their email in Gmail, and places near them on Google Maps',
    tools: ['search_mail', 'read_mail', 'find_places'],
  },
  {
    key: 'dev',
    about: 'the app itself: specs, Dev rows, X post drafts, projects, plan builds, cron routes, session hand-offs and the model Dash answers with',
    tools: [
      'read_spec',
      'read_dev_row',
      'find_dev_text',
      'post_pictures',
      'session_handoffs',
      'rewrite_post',
      'suggest_post',
      'add_project',
      'run_app_route',
      'propose_build',
      'dash_model',
      'set_dash_model',
    ],
  },
];

/** How a voice loads its tools: the ones always sent, and the areas the rest open from. */
export type ToolBranches = {
  /** The areas, each kept to the tools the voice has, with empty areas dropped. */
  areas: readonly ToolArea[];
  /** The tools sent with `defer_loading: true`, loaded only by opening their area. */
  deferred: ReadonlySet<string>;
};

/**
 * The branches for a voice's tools: every tool in an area and not in
 * `loaded` is deferred; the rest are sent as they are.
 */
export function toolBranches(
  tools: readonly DashTool[],
  loaded: readonly string[] = BOT_LOADED,
  areas: readonly ToolArea[] = TOOL_AREAS,
): ToolBranches {
  const has = new Set(tools.map((tool) => tool.name));
  const keep = new Set(loaded);
  const kept = areas
    .map((area) => ({ ...area, tools: area.tools.filter((name) => has.has(name) && !keep.has(name)) }))
    .filter((area) => area.tools.length > 0);
  return { areas: kept, deferred: new Set(kept.flatMap((area) => area.tools)) };
}

/** The open_area tool for a voice's areas, its description the menu of them. */
export function openAreaTool(areas: readonly ToolArea[]): Anthropic.Tool {
  const menu = areas.map((area) => `${area.key}: ${area.about}`).join('\n');
  return {
    name: OPEN_AREA_TOOL,
    description:
      'Load the tools for one area of the app before you use them. The tools you see now find and read their rows and make the everyday changes; for anything else, open its area first, then call the tool it loads. Open an area only when the person asks for something in it, and open each area once. The areas:\n' +
      menu,
    input_schema: {
      type: 'object',
      properties: { area: { type: 'string', enum: areas.map((area) => area.key) } },
      required: ['area'],
      additionalProperties: false,
    },
  };
}

/** A tool_result's content block that loads one deferred tool. */
export type ToolReferenceBlock = { type: 'tool_reference'; tool_name: string };

/**
 * What open_area returns for an area key: the area's tools as
 * tool_reference blocks, or an error naming the keys.
 */
export function openArea(
  branches: ToolBranches,
  input: unknown,
): { ok: true; key: string; blocks: ToolReferenceBlock[] } | { ok: false; error: string } {
  const key = input && typeof input === 'object' ? (input as { area?: unknown }).area : undefined;
  const area = branches.areas.find((a) => a.key === key);
  if (!area) {
    return { ok: false, error: `There is no area called ${String(key)}. The areas are ${branches.areas.map((a) => a.key).join(', ')}.` };
  }
  return { ok: true, key: area.key, blocks: area.tools.map((name) => ({ type: 'tool_reference', tool_name: name })) };
}
