import { describe, expect, it } from 'vitest';
import {
  BROKER_SKILL,
  THREAD_SESSION_MODEL,
  brokerWakeText,
  jobFor,
  transcriptText,
  turnText,
  waitingOf,
  type BrokerMessage,
  type BrokerRepo,
  type BrokerThread,
} from './broker-model';

const THREAD = '11111111-1111-4111-8111-111111111111';
const APP: BrokerRepo = { owner: 'someone', repo: 'PersonalDashboard', branch: 'main', label: 'This app' };
const PROJECT: BrokerRepo = { owner: 'someone', repo: 'music-pipeline', branch: 'main', label: 'Music pipeline' };

function thread(fields: Partial<BrokerThread> = {}): BrokerThread {
  return { id: THREAD, title: 'Fix the export', projectId: null, sessionId: null, state: 'queued', ...fields };
}

let n = 0;
function message(fields: Partial<BrokerMessage>): BrokerMessage {
  n += 1;
  return {
    id: `m${n}`,
    author: 'person',
    kind: 'text',
    body: 'Hello',
    options: null,
    artifactUrl: null,
    attachmentPath: null,
    deliveredAt: null,
    answer: null,
    answeredAt: null,
    createdAt: `2026-11-05T10:00:${String(n).padStart(2, '0')}.000Z`,
    ...fields,
  };
}

const none = new Map<string, string>();

describe('brokerWakeText', () => {
  it('names the thread and points at the skill after a pull', () => {
    const text = brokerWakeText(THREAD);
    expect(text).toContain(THREAD);
    expect(text).toContain(BROKER_SKILL);
    expect(text.indexOf('git fetch origin main')).toBeLessThan(text.indexOf(BROKER_SKILL));
  });
});

describe('waitingOf', () => {
  it('takes undelivered person messages and answered, unpassed questions, in the order they happened', () => {
    const asked = message({
      author: 'session',
      kind: 'question',
      body: 'Merge?',
      options: ['Yes', 'No'],
      answer: 'Yes',
      answeredAt: '2026-11-05T11:00:00.000Z',
    });
    const later = message({ body: 'And one more thing' });
    const rows = [
      message({ body: 'old', deliveredAt: '2026-11-05T10:30:00.000Z' }),
      asked,
      message({ author: 'session', kind: 'text', body: 'A reply' }),
      message({ author: 'session', kind: 'question', body: 'Unanswered?', options: ['A', 'B'] }),
      later,
    ];
    expect(waitingOf(rows).map((m) => m.id)).toEqual([later.id, asked.id]);
  });

  it('leaves out a question whose answer was already passed on', () => {
    const passed = message({
      author: 'session',
      kind: 'question',
      body: 'Merge?',
      answer: 'Yes',
      answeredAt: '2026-11-05T11:00:00.000Z',
      deliveredAt: '2026-11-05T11:00:05.000Z',
    });
    expect(waitingOf([passed])).toEqual([]);
  });
});

describe('turnText', () => {
  it('quotes what the person wrote, with a file link, the mockup it is about, and an answer', () => {
    const text = turnText(
      thread({ sessionId: 'session_1', state: 'working' }),
      [
        message({ body: 'Look at this', attachmentPath: 'u/abc-shot.png' }),
        message({ body: 'Picked the mockup "Home"', artifactUrl: 'https://claude.ai/artifact/x' }),
        message({ author: 'session', kind: 'question', body: 'Merge?', options: ['Yes', 'No'], answer: 'No', answeredAt: 'x' }),
      ],
      new Map([['u/abc-shot.png', 'https://files.example/signed']]),
    );
    expect(text).toContain(`thread ${THREAD}`);
    expect(text).toContain('> Look at this');
    expect(text).toContain('> Attached file: https://files.example/signed');
    expect(text).toContain('> (This is about your page at https://claude.ai/artifact/x)');
    expect(text).toContain('They answered:\n> Your question: Merge? (options: Yes / No)\n> Their answer: No');
    expect(text).toContain(`reply_in_thread (thread_id ${THREAD})`);
  });
});

describe('transcriptText', () => {
  it('lists every turn but the status lines, oldest first', () => {
    const text = transcriptText(
      [
        message({ body: 'First', createdAt: '2026-11-05T10:00:00.000Z' }),
        message({ author: 'session', kind: 'status', body: 'Reading the code', createdAt: '2026-11-05T10:00:10.000Z' }),
        message({ author: 'session', kind: 'mockup', body: 'Home', artifactUrl: 'https://claude.ai/artifact/y', createdAt: '2026-11-05T10:01:00.000Z' }),
      ],
      none,
    );
    expect(text).not.toContain('Reading the code');
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('https://claude.ai/artifact/y'));
    expect(text).toContain('You (a mockup)');
  });
});

describe('jobFor', () => {
  it('starts a session on this app for a new thread, on Opus, with the thread in its prompt', () => {
    const first = message({ body: 'Why does the export fail?' });
    const job = jobFor({ thread: thread(), messages: [first], repo: APP, links: none, brokerSessionId: 'session_broker' })!;
    expect(job.action).toBe('start');
    expect(job.source_url).toBe('https://github.com/someone/PersonalDashboard');
    expect(job.model).toBe(THREAD_SESSION_MODEL);
    expect(job.deliver).toEqual([first.id]);
    expect(job.prompt).toContain('> Why does the export fail?');
    expect(job.prompt).toContain(`reply_in_thread, with thread_id ${THREAD}`);
    expect(job.prompt).toContain('never by session_id');
    expect(job.prompt).toContain('kind "question"');
    expect(job.prompt).toContain('report_progress');
    expect(job.prompt).toContain("repository's own CLAUDE.md");
    expect(job.prompt).toContain('Broker session: session_broker');
    expect(job.prompt).not.toContain('An earlier session on this thread has ended');
  });

  it('sends to the session a thread already has, and its prompt is a replacement given the transcript', () => {
    const replied = message({ author: 'session', body: 'It times out.', createdAt: '2026-11-05T10:00:30.000Z' });
    const next = message({ body: 'Can you fix it?', createdAt: '2026-11-05T10:01:00.000Z' });
    const job = jobFor({
      thread: thread({ sessionId: 'session_2', state: 'idle', projectId: 'music-pipeline' }),
      messages: [message({ body: 'Why?', deliveredAt: 'x', createdAt: '2026-11-05T10:00:00.000Z' }), replied, next],
      repo: PROJECT,
      links: none,
      brokerSessionId: null,
    })!;
    expect(job.action).toBe('send');
    expect(job.session_id).toBe('session_2');
    expect(job.source_url).toBe('https://github.com/someone/music-pipeline');
    expect(job.session_title).toContain('(Music pipeline)');
    expect(job.deliver).toEqual([next.id]);
    expect(job.message).toContain('> Can you fix it?');
    expect(job.message).not.toContain('Why?');
    expect(job.prompt).toContain('An earlier session on this thread has ended');
    expect(job.prompt).toContain('> It times out.');
    expect(job.prompt).toContain('project music-pipeline');
  });

  it('has nothing to do for a thread with nothing waiting, an ended thread, or a wake test', () => {
    const delivered = message({ deliveredAt: 'x' });
    expect(jobFor({ thread: thread(), messages: [delivered], repo: APP, links: none, brokerSessionId: null })).toBeNull();
    expect(
      jobFor({ thread: thread({ state: 'ended' }), messages: [message({})], repo: APP, links: none, brokerSessionId: null }),
    ).toBeNull();
    expect(
      jobFor({ thread: thread({ title: 'Wake test abc123 #3' }), messages: [message({})], repo: APP, links: none, brokerSessionId: null }),
    ).toBeNull();
  });
});
