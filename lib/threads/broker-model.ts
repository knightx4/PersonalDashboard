/**
 * What the session broker hands a thread's session (plan #2789.6, feature
 * #2789), as pure functions so the tests and the broker's script read the
 * same text.
 *
 * The broker is a standing Claude Code session on this repository, woken by
 * a routine fire each time the person writes in a session thread. On a wake
 * it runs `npm run broker -- pending`, which prints what each thread has
 * waiting, and for each thread either starts a session (create_session with
 * `threadSessionPrompt`) or passes the waiting messages to the thread's
 * session (send_message with `turnText`). Its skill is
 * .claude/skills/session-broker/SKILL.md.
 *
 * Two kinds of row wait to be passed on:
 *
 *   a person's message   author 'person', delivered_at null.
 *   an answered question  the session's own question, answered by a press,
 *                         delivered_at null. delivered_at on a question
 *                         means the answer has reached the session; nothing
 *                         else sets it on a session's row.
 *
 * read_thread on the connector also marks a person's message delivered, so a
 * message the session already read is not passed twice.
 */

import { OPUS } from '@/lib/core/models';

/** The broker's skill, which the wake-up text points at. */
export const BROKER_SKILL = '.claude/skills/session-broker/SKILL.md';

/** A thread's session talks and designs, so it runs on Opus. */
export const THREAD_SESSION_MODEL = OPUS;

/** A file link handed to a session lasts this long. */
export const FILE_LINK_SECONDS = 7 * 24 * 60 * 60;

export type BrokerThread = {
  id: string;
  title: string;
  projectId: string | null;
  sessionId: string | null;
  state: string;
  /**
   * 'think': a question from Ask Dash's Think it through (plan #2789.11),
   * answered with no change made. Absent or 'work': a thread on the code.
   */
  mode?: 'work' | 'think';
};

export type BrokerMessage = {
  id: string;
  author: 'person' | 'session';
  kind: string;
  body: string;
  options: string[] | null;
  artifactUrl: string | null;
  attachmentPath: string | null;
  deliveredAt: string | null;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
};

/** Where the thread's session works: the project's repository, or this app's. */
export type BrokerRepo = { owner: string; repo: string; branch: string; label: string };

/** What one thread needs from the broker on this wake. */
export type BrokerJob = {
  thread_id: string;
  title: string;
  state: string;
  /** start: no session yet, so create one. send: pass `message` to session_id. */
  action: 'start' | 'send';
  session_id: string | null;
  source_url: string;
  session_title: string;
  model: string;
  /** The whole prompt for create_session: on start, and to replace a session that has ended. */
  prompt: string;
  /** The turn for send_message. */
  message: string;
  /** The rows this job passes on, to mark delivered once it has. */
  deliver: string[];
};

/** The text the app fires the broker's wake-up task with. */
export function brokerWakeText(threadId: string): string {
  return [
    `A message is waiting in session thread ${threadId}.`,
    `Pull main first (git fetch origin main && git reset --hard origin/main), then follow ${BROKER_SKILL}.`,
  ].join(' ');
}

/** The rows of a thread that wait to be passed to its session, in the order they happened. */
export function waitingOf(messages: readonly BrokerMessage[]): BrokerMessage[] {
  return messages
    .filter(
      (m) =>
        m.deliveredAt === null &&
        ((m.author === 'person' && m.kind !== 'status') || (m.kind === 'question' && m.answer !== null)),
    )
    .sort((a, b) => whenOf(a).localeCompare(whenOf(b)));
}

function whenOf(m: BrokerMessage): string {
  return m.kind === 'question' && m.answeredAt ? m.answeredAt : m.createdAt;
}

function quote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/** One row as the session reads it. `links` maps an attachment path to a link the session can open. */
export function messageText(m: BrokerMessage, links: ReadonlyMap<string, string>): string {
  if (m.kind === 'question' && m.author === 'session') {
    const asked = `Your question: ${m.body.trim()}${m.options?.length ? ` (options: ${m.options.join(' / ')})` : ''}`;
    return m.answer ? `${asked}\nTheir answer: ${m.answer}` : asked;
  }
  const lines: string[] = [];
  if (m.body.trim()) lines.push(m.body.trim());
  if (m.artifactUrl) lines.push(`(This is about your page at ${m.artifactUrl})`);
  if (m.attachmentPath) {
    const link = links.get(m.attachmentPath);
    lines.push(link ? `Attached file: ${link}` : `Attached file: ${m.attachmentPath} (no link could be made)`);
  }
  return lines.join('\n');
}

/** The turn send_message carries: what the person wrote or answered since the session last heard. */
export function turnText(
  thread: BrokerThread,
  waiting: readonly BrokerMessage[],
  links: ReadonlyMap<string, string>,
): string {
  const parts = waiting.map((m) =>
    m.kind === 'question' ? `They answered:\n${quote(messageText(m, links))}` : quote(messageText(m, links)),
  );
  return [
    `From the person, in Dash session thread ${thread.id}:`,
    '',
    parts.join('\n\n'),
    '',
    `Reply with reply_in_thread (thread_id ${thread.id}), as your prompt says.`,
  ].join('\n');
}

/** Every row of the thread so far, for a session that starts without having seen it. */
export function transcriptText(messages: readonly BrokerMessage[], links: ReadonlyMap<string, string>): string {
  const ordered = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return ordered
    .filter((m) => m.kind !== 'status')
    .map((m) => {
      const who = m.author === 'person' ? 'The person' : m.kind === 'mockup' ? 'You (a mockup)' : 'You';
      const body = m.kind === 'mockup' ? [m.body.trim(), m.artifactUrl].filter(Boolean).join('\n') : messageText(m, links);
      return `${who}, ${m.createdAt}:\n${quote(body)}`;
    })
    .join('\n\n');
}

/**
 * The thread session's prompt. A new session gets it whole, with the thread
 * so far; a session that replaces one that ended gets the same, so it reads
 * what the last one said before carrying on.
 */
export function threadSessionPrompt(input: {
  thread: BrokerThread;
  repo: BrokerRepo;
  brokerSessionId: string | null;
  transcript: string;
  replacing: boolean;
}): string {
  const { thread, repo } = input;
  const id = thread.id;
  const where =
    thread.projectId === null
      ? `this app's own repository (${repo.owner}/${repo.repo})`
      : `the ${repo.label} project's repository (${repo.owner}/${repo.repo})`;
  return [
    `You are in a conversation with the person in Dash, their dashboard app. They opened a session thread there, from Chat or a project page, to talk to a session working on ${where}, which is this session's checkout. They read and write in the app, on a phone as often as not, and never see this session's own transcript.`,
    '',
    'How you talk to them',
    '',
    `- Every word they should read goes through the Dash connector's reply_in_thread, with thread_id ${id}. Name the thread by thread_id only, never by session_id. Text you write anywhere else reaches nobody.`,
    '- Reply when you have something to say: an answer, a finding, a plan, or a question. Keep each reply short enough to read on a phone. Write in plain sentences, to docs/WRITING-GUIDE.md where the repository has it.',
    '- When you need them to decide something, ask with kind "question", the question as body and two to four options, each a short choice they can press. Put your recommendation in the question. Then stop and wait; their answer reaches you as a new turn.',
    '- When you publish a mockup or a page, write it with kind "mockup" and its link as artifact_url.',
    '- A line on what you are doing goes as kind "status". Use it before a stretch of work that takes minutes, not for every step.',
    `- Report your progress with the connector's report_progress: session_id $CLAUDE_CODE_REMOTE_SESSION_ID, thread_id ${id}${thread.projectId ? `, project ${thread.projectId}` : ''}. State "working" when you start and after each commit, "waiting" with needs set when you ask them something, and "done" when the thread's work is finished.`,
    '- Their next messages reach you as turns from the broker session that started you. Each one is what they wrote in the app. If you wonder whether you missed something, read_thread (thread_id as above) returns everything written since a point.',
    '- Files they attach come as links that last a week. Open them with a plain fetch.',
    '',
    ...(thread.mode === 'think' ? thinkSection(id) : []),
    'How you work',
    '',
    "- Follow this repository's own CLAUDE.md. Its rules on migrations, the gate, commits and merging hold here as in any session.",
    '- Do what they ask in the thread and nothing beyond it. Changing code, committing and merging follow the repository\'s rules; ask in the thread first when a change is large or they have not said to make it.',
    '- Anything sent outside the repository and the app (an email, a post, a purchase, a change to another service) waits for their yes in the thread.',
    '- If the Dash connector is not loaded, say so in your final message and stop: there is no other way to reach them.',
    '',
    input.brokerSessionId ? `Broker session: ${input.brokerSessionId}` : '',
    `Thread: ${id}`,
    `Title: ${thread.title}`,
    '',
    input.replacing
      ? 'An earlier session on this thread has ended. The thread so far is below; read it, then answer what is still waiting. Your first reply_in_thread is the one they will see next.'
      : 'The thread so far is below. Answer it.',
    '',
    input.transcript,
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n');
}

/**
 * What a think-it-through thread's session is told on top (plan #2789.11):
 * the question came from Ask Dash with Think it through on, so it answers
 * in words and changes nothing.
 */
function thinkSection(id: string): string[] {
  return [
    'This thread is a question to think through',
    '',
    "- The person asked it in Ask Dash with Think it through on. It needs thought, not a change to the code: a design idea for the app, a choice in their career or life, or what an article or a product means for what they are building. The chat so far is the thread's first message, and the last question in it is the one to answer.",
    '- Change nothing. Do not edit files, commit, push, open a pull request, apply a migration or write a row: no plan rows (propose_feature, add_plan_step, write_decision) and no Dash writes. Read the code, the specs and the docs freely, and search the web.',
    '- Weigh the options against each other and name what each costs. Ground what you say about the app in what you read, naming the files. Cite each source you rely on with its link.',
    '- End with what you would do and why, and say plainly where you are unsure.',
    `- Before a stretch of reading, write one status line (reply_in_thread, kind "status") on what you are looking at, so they can see where you are. Then give the whole answer in one reply_in_thread of kind "text" with thread_id ${id}: plain prose, a list where it helps, each part opened with its name in bold. It can be longer than a usual reply, but every paragraph earns its place.`,
    '- If they ask in the thread for a change afterwards, say that this thread only thinks, and that they can start a session thread from Chat to make it.',
    '- Then report_progress with state "done".',
    '',
  ];
}

/** The source_url create_session takes for a repository. */
export function sourceUrl(repo: Pick<BrokerRepo, 'owner' | 'repo'>): string {
  return `https://github.com/${repo.owner}/${repo.repo}`;
}

/** The session's title as the Claude app lists it. */
export function sessionTitle(thread: BrokerThread, repo: BrokerRepo): string {
  const title = `Dash thread: ${thread.title}`;
  const named = thread.projectId ? `${title} (${repo.label})` : title;
  return named.length > 120 ? `${named.slice(0, 119).trimEnd()}…` : named;
}

/**
 * A trial thread of the wake-time measurement (lib/threads/broker-wake-test.ts),
 * whose wake text says what to do with it. The broker leaves these alone.
 */
const WAKE_TEST_TITLE = /^Wake test [a-z0-9]{6} #\d{1,2}$/;

/** One thread's job on this wake, or null when nothing waits in it. */
export function jobFor(input: {
  thread: BrokerThread;
  messages: readonly BrokerMessage[];
  repo: BrokerRepo;
  links: ReadonlyMap<string, string>;
  brokerSessionId: string | null;
}): BrokerJob | null {
  const { thread, messages, repo, links } = input;
  if (thread.state === 'ended' || WAKE_TEST_TITLE.test(thread.title)) return null;
  const waiting = waitingOf(messages);
  if (waiting.length === 0) return null;
  const replacing = thread.sessionId !== null;
  return {
    thread_id: thread.id,
    title: thread.title,
    state: thread.state,
    action: thread.sessionId ? 'send' : 'start',
    session_id: thread.sessionId,
    source_url: sourceUrl(repo),
    session_title: sessionTitle(thread, repo),
    model: THREAD_SESSION_MODEL,
    prompt: threadSessionPrompt({
      thread,
      repo,
      brokerSessionId: input.brokerSessionId,
      transcript: transcriptText(messages, links),
      replacing,
    }),
    message: turnText(thread, waiting, links),
    deliver: waiting.map((m) => m.id),
  };
}
