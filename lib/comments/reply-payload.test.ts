import { describe, expect, it } from 'vitest';
import { MAX_REPLY, parseReplyPayload } from './reply-payload';

describe('parseReplyPayload', () => {
  it('reads an answer', () => {
    expect(parseReplyPayload({ answer: 'B costs a migration.', needs_repo: false })).toEqual({
      kind: 'answer',
      body: 'B costs a migration.',
    });
  });

  it('reads a hand-off to a session', () => {
    expect(
      parseReplyPayload({ needs_repo: true, why: 'It depends what loadPlan selects today.' }),
    ).toEqual({
      kind: 'needs_repo',
      why: 'It depends what loadPlan selects today.',
      instruction: false,
    });
  });

  it('says what it would read even when nothing said it', () => {
    const reply = parseReplyPayload({ needs_repo: true });
    expect(reply).toEqual({
      kind: 'needs_repo',
      why: 'This one needs a look at the code.',
      instruction: false,
    });
  });

  it('does not let an answer ride along with a hand-off', () => {
    expect(parseReplyPayload({ answer: 'Probably four.', needs_repo: true, why: 'Have to count.' })).toEqual(
      { kind: 'needs_repo', why: 'Have to count.', instruction: false },
    );
  });

  it('refuses an empty answer', () => {
    expect(parseReplyPayload({ answer: '   ' }).kind).toBe('error');
    expect(parseReplyPayload({}).kind).toBe('error');
  });

  it('refuses a payload of the wrong shape', () => {
    expect(parseReplyPayload({ answer: 12 }).kind).toBe('error');
    expect(parseReplyPayload(null).kind).toBe('error');
  });

  it('trims a reply the column would refuse', () => {
    const reply = parseReplyPayload({ answer: 'x'.repeat(MAX_REPLY + 500) });
    expect(reply.kind).toBe('answer');
    if (reply.kind !== 'answer') return;
    expect(reply.body).toHaveLength(MAX_REPLY);
    expect(reply.body.endsWith('…')).toBe(true);
  });
});

describe('an instruction rather than a question', () => {
  it('reads the action and its arguments', () => {
    expect(
      parseReplyPayload({
        action: { name: 'file_idea', text: 'Photos on receipts.', module: 'shopping' },
      }),
    ).toEqual({
      kind: 'action',
      action: {
        name: 'file_idea',
        text: 'Photos on receipts.',
        module: 'shopping',
        field: null,
        detail: null,
        kind: null,
      },
    });
  });

  it('reads the detail and the kind the two newer actions take', () => {
    const reply = parseReplyPayload({
      action: { name: 'add_step', text: 'Crop the photo', detail: 'Square, centred on the shelf.' },
    });
    expect(reply.kind === 'action' && reply.action.detail).toBe('Square, centred on the shelf.');

    const note = parseReplyPayload({ action: { name: 'file_note', text: 'It opens wrong.', kind: 'bug' } });
    expect(note.kind === 'action' && note.action.kind).toBe('bug');
  });

  it('keeps a name nobody listed, so it can be refused in words', () => {
    const reply = parseReplyPayload({ action: { name: 'approve_step' } });
    expect(reply.kind).toBe('action');
    expect(reply.kind === 'action' && reply.action.name).toBe('approve_step');
  });

  it('does the instruction rather than the explanation that came with it', () => {
    const reply = parseReplyPayload({
      answer: 'I could file that as an idea.',
      action: { name: 'file_idea', text: 'Photos on receipts.' },
    });
    expect(reply.kind).toBe('action');
  });

  it('leaves an action alone when the reply says it needs the code first', () => {
    const reply = parseReplyPayload({
      needs_repo: true,
      why: 'It depends what the shape action reads.',
      action: { name: 'file_idea', text: 'Photos on receipts.' },
    });
    expect(reply).toEqual({
      kind: 'needs_repo',
      why: 'It depends what the shape action reads.',
      // The action it named is what says it was told to do something.
      instruction: true,
    });
  });

  it('refuses an action with no name', () => {
    expect(parseReplyPayload({ action: { name: '  ' } }).kind).toBe('error');
    expect(parseReplyPayload({ action: {} }).kind).toBe('error');
  });

  it('says an instruction is one, so the session it hands to knows', () => {
    const reply = parseReplyPayload({
      needs_repo: true,
      why: 'The wording depends on what the loader reads.',
      instruction: true,
    });
    expect(reply).toEqual({
      kind: 'needs_repo',
      why: 'The wording depends on what the loader reads.',
      instruction: true,
    });
  });

  it('still answers a question exactly as it did', () => {
    expect(parseReplyPayload({ answer: 'B costs a migration.', action: null })).toEqual({
      kind: 'answer',
      body: 'B costs a migration.',
    });
  });
});
