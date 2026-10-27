import { courseHref, transcriptHref } from '@/lib/you/education';
import { parentBy, type ModuleSources, type Section } from '@/lib/sources/types';
import { jobHref } from '@/lib/you/work-history';
import { profileHref } from '@/lib/you/profile-entries';

/** The sections of You's nav its rows sit under (app/you/layout.tsx). */
const PERSONALITY: Section = { href: '/you/personality', label: 'Personality' };
const DETAILS: Section = { href: '/you/details', label: 'Details' };
const PLACES: Section = { href: '/you/places', label: 'Places' };
const WORK: Section = { href: '/you/work', label: 'Work & school' };
const INSIGHTS: Section = { href: '/you/insights', label: 'Insights' };
const BOARD: Section = { href: '/you/board', label: 'Board' };

/**
 * You's tables (lib/sources/types.ts): what is true about the person. Each is
 * what they did or said about themselves, so each is a source Goals may read.
 * Places is typed by hand. The transcripts and courses moved here from the Vault (plan #1991.3). A new
 * table in the you schema goes in one of the two lists, or the gate says so.
 */
export const youSources: ModuleSources = {
  sources: [
    {
      table: 'you.courses',
      module: 'You',
      holds: 'Every course on their academic transcripts: the school, code, title, term, credits and grade, as written.',
      weight: 'record',
      search: ['title', 'code', 'school', 'term'],
      title: 'title',
      href: courseHref,
      section: WORK,
      parent: parentBy('transcript_id', 'you.transcripts'),
      note:
        'transcript_id points at you.transcripts. year is the year of the term where the transcript gives one. ' +
        'grade is null for a course with no grade, such as transfer credit.',
    },
    {
      table: 'you.course_files',
      module: 'You',
      holds: 'The files they kept from a course: its syllabus, lecture slides, lecture notes and readings, each marked with its week.',
      weight: 'record',
      search: ['title', 'file_name', 'kind'],
      title: 'title',
      facts: ['week'],
      newest: 'uploaded_at',
      // A file opens on its course's line, which its ref alone cannot name.
      page: {
        title: 'title',
        reads: ['course_id'],
        href: (row) => (row.course_id ? courseHref(String(row.course_id)) : null),
        section: WORK,
        parent: parentBy('course_id', 'you.courses'),
      },
      note:
        'course_id points at you.courses. kind is syllabus, slides, lecture_notes or reading. ' +
        'week is the week of the course, or null for a file that spans it. ' +
        'The file is in the private you-course-files bucket at storage_path; a course holds at most 20.',
    },
    {
      table: 'you.course_weeks',
      module: 'You',
      holds: "The weeks of a course they took and each week's topic, read from its syllabus and corrected by them.",
      weight: 'record',
      search: ['title'],
      title: 'title',
      facts: ['week', 'edited_at', 'removed_at'],
      newest: 'created_at',
      // A week opens on its course's line, which its ref alone cannot name.
      page: {
        title: 'title',
        reads: ['course_id'],
        href: (row) => (row.course_id ? courseHref(String(row.course_id)) : null),
        section: WORK,
        parent: parentBy('course_id', 'you.courses'),
      },
      note:
        'course_id points at you.courses. week is the week number; a file in you.course_files with the same course_id and week sits in it. ' +
        'title is null for a week the syllabus names without a topic. edited_at is set when they changed the title themselves; ' +
        'a row with removed_at is a week they removed, so leave it out.',
    },
    {
      table: 'you.transcripts',
      module: 'You',
      holds: 'The academic transcripts they have uploaded, one per school record, with the original file kept.',
      weight: 'record',
      search: ['school', 'file_name'],
      title: 'school',
      newest: 'uploaded_at',
      href: transcriptHref,
      section: WORK,
      note: 'The courses on each are in you.courses. The file is in the private vault-transcripts bucket at storage_path.',
    },
    {
      table: 'you.personality_results',
      module: 'You',
      holds: 'Personality tests they took or typed in, each with its date: Big Five scores, or a type such as INTJ or 5w4.',
      weight: 'record',
      search: ['test_name', 'typed_value', 'note', 'read_points'],
      title: 'test_name',
      href: () => '/you/personality',
      section: PERSONALITY,
      note: 'kind is big_five, mbti, enneagram or other. A big_five row has the five IPIP factor scores, 10 to 50 each (extraversion, agreeableness, conscientiousness, emotional_stability, intellect); the others have typed_value, the type as they typed it in from a test taken elsewhere. note is an optional line of their own about the result. A retake is a new row, so read the latest by taken_at. read_points is Dash\'s read of the result against their notes, once written.',
    },
    {
      table: 'you.details',
      module: 'You',
      holds: 'Their own details, one row: phone, LinkedIn address, citizenship, race, gender and sexuality, as they wrote them, and any fields they named themselves.',
      weight: 'record',
      search: ['title', 'phone', 'linkedin_url', 'citizenship', 'race', 'gender', 'sexuality'],
      title: 'title',
      // custom_fields is read as the JSON list, so Dash can answer from them.
      facts: ['custom_fields'],
      newest: 'updated_at',
      ref: 'user_id',
      owner: 'user_id',
      href: () => '/you/details',
      section: DETAILS,
      // One row per person, with no id to name it by.
      page: null,
      note: 'custom_fields is a jsonb list of {id, label, value}, the fields they named themselves (at most 30). A null is a detail they have not given. They chose that Dash may read all six (plan #2124.3).',
    },
    {
      table: 'you.now',
      module: 'You',
      holds: 'Where they are at the moment, one row in their own words: money, what they are focused on, what they have decided against.',
      weight: 'record',
      search: ['body'],
      title: 'body',
      newest: 'updated_at',
      ref: 'user_id',
      owner: 'user_id',
      href: () => '/you/insights',
      section: INSIGHTS,
      // One row per person, with no id to name it by.
      page: null,
      note: 'Written on the Insights tab (you 0018). Every insights run reads it first; it is their current situation, so it outranks older notes on the same subject.',
    },
    {
      table: 'you.claude_chats',
      module: 'You',
      holds: 'What they wrote in their chats with Claude: their own messages from the claude.ai export, and things they said about themselves saved during a chat, with why.',
      weight: 'record',
      search: ['body', 'conversation_title', 'why'],
      title: 'conversation_title',
      newest: 'said_at',
      ref: 'id',
      owner: 'user_id',
      href: () => '/you/insights',
      section: INSIGHTS,
      page: null,
      note: 'origin is export (one of their messages from conversations.json, with conversation_title) or saved (saved by save_about_me during a chat, with why). Only their own messages are kept, never Claude\'s replies, so a message often answers something not shown. Much of it is asking for help with code or writing; the moments that say something about them are the minority.',
    },
    {
      table: 'you.places',
      module: 'You',
      holds: 'The places they have lived, with when they moved in and out.',
      weight: 'record',
      search: ['name', 'city', 'region', 'country', 'note'],
      title: 'name',
      facts: ['moved_in', 'moved_out'],
      newest: 'moved_in',
      href: (id) => `/you/places/${id}`,
      section: PLACES,
      note: 'moved_in and moved_out are a year (YYYY) or a month (YYYY-MM); no moved_out means they live there now. A place counts for a year when it was moved into that year or before and left that year or after.',
    },
    {
      table: 'you.work_history',
      module: 'You',
      holds: 'The jobs they have held: employer, title, place and dates, read from their résumé or added by hand.',
      weight: 'record',
      search: ['employer', 'title', 'place', 'note'],
      title: 'employer',
      facts: ['started', 'ended', 'edited'],
      newest: 'started',
      href: jobHref,
      section: WORK,
      parent: parentBy('resume_id', 'job_search.resume_versions'),
      note:
        'started and ended are "YYYY" or "YYYY-MM"; ended is null for the job they hold now. ' +
        'edited is true when they corrected the row or added it themselves, so it is what they said rather than what Dash read. ' +
        'source is linkedin for a job the LinkedIn import wrote or filled in.',
    },
    {
      table: 'you.profile_entries',
      module: 'You',
      holds: 'The schools, certifications, honors, skills and courses on their LinkedIn profile.',
      weight: 'record',
      search: ['name', 'detail', 'description', 'activities'],
      title: 'name',
      facts: ['kind', 'started', 'ended', 'code'],
      newest: 'started',
      href: profileHref,
      section: WORK,
      note:
        'kind is school, certification, honor, skill or course. detail is a school\'s degree or a certification\'s authority; ' +
        'code is a certification\'s license number or a course\'s number. started and ended are "YYYY" or "YYYY-MM"; ' +
        'an honor\'s started is the day it was issued. Written by the LinkedIn import (plan #2432.7).',
    },
    {
      table: 'you.board_questions',
      module: 'You',
      holds: 'The decisions they put to their board: the question, its options, the way they were leaning, and what they decided.',
      weight: 'intent',
      search: ['question', 'context', 'lean', 'decision_note'],
      title: 'question',
      facts: ['status', 'source', 'decided_option', 'decided_at'],
      newest: 'created_at',
      href: () => '/you/board',
      section: BOARD,
      page: null,
      note:
        'options is [ { letter, text } ]; decided_option is the letter they chose. status is suggested, queued, discussing, decided, dismissed or deferred. ' +
        'source is person (they asked), suggested (Dash suggested it; only theirs once accepted, so leave status suggested and dismissed rows out) or board. ' +
        'verdict is the board\'s recommendation, written by Dash, so cite their decision rather than the verdict (you 0022). ' +
        'reviews is the board checking back 30 and 90 days after the decision: account is Dash\'s, outcome (well, mixed or badly) is theirs; topic is work, money, learning, projects, place or time (you 0026).',
    },
  ],
  notSources: [
    {
      table: 'you.course_overviews',
      reason:
        "Dash's account of what a course was about and which ideas recurred, made on a press from the file summaries; what the person kept is the files in you.course_files.",
    },
    {
      table: 'you.course_file_summaries',
      reason:
        "Dash's summary and key points of a course file, made on a press of Summarise; what the person kept is the file in you.course_files.",
    },
    // Dash's writing about the person (plan #2413.1). Goals reading them would
    // cite Dash to itself as though it were something the person said.
    { table: 'you.insights', reason: 'Insights Dash wrote about them; Goals reading them would cite Dash to itself.' },
    { table: 'you.insight_verdicts', reason: 'Their marks on Dash\'s insights, read by the insights run, not by Goals.' },
    { table: 'you.insight_runs', reason: 'Bookkeeping for the runs that write insights.' },
    { table: 'you.board_meetings', reason: 'Minutes Dash wrote for the board meetings; Goals reading them would cite Dash to itself.' },
    { table: 'you.board_marks', reason: 'Their votes, answers and ticks on the board\'s minutes, read by the next board meeting, not by Goals.' },
    { table: 'you.board_advisors', reason: 'The board\'s roster and the brains Dash built for its guests from their public work.' },
    { table: 'you.board_turns', reason: 'What each advisor said in a board debate, written by Dash; Goals reading them would cite Dash to itself.' },
    { table: 'you.insight_digest', reason: 'Dash\'s notes about them for its next insights call (plan #2413.9); Goals reading them would cite Dash to itself.' },
    // Lines from their private notes for the insights run (plan #2413.8).
    {
      table: 'you.note_extracts',
      reason:
        'Quotes copied out of their private notes in obsidian.notes, which Goals already reads whole; reading both would count the same words twice.',
    },
    { table: 'you.note_extract_reads', reason: 'Bookkeeping: which version of each note was read for its lines.' },
    // Counted from the sources themselves each night (plan #2413.7); Goals
    // reads those rows directly.
    { table: 'you.insight_signals', reason: 'Nightly counts worked out from other workspaces\' rows for the insights run.' },
    { table: 'you.insight_tripwires', reason: 'What brings one of Dash\'s insights back, and when it last fired.' },
  ],
};
