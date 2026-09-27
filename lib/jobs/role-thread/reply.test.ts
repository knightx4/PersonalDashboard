import { describe, expect, it } from 'vitest';
import {
  COVER_LETTER_MAX,
  parseRoleReply,
  renderBank,
  replyBody,
  roleReplyMessage,
  type RoleReplyContext,
} from './reply';

const context: RoleReplyContext = {
  role: {
    title: 'Data Engineer',
    seniority: null,
    location: 'London',
    workMode: 'hybrid',
    jdText: 'You will own the warehouse migration.',
  },
  company: { name: 'Acme', industry: null, stage: null, research: null },
  application: { status: 'interested', coverLetter: null },
  matches: [
    {
      requirement: 'Warehouse migrations',
      kind: 'must_have',
      verdict: 'strong',
      evidenceItemId: 'uuid-2',
    },
    { requirement: 'Kafka', kind: 'nice_to_have', verdict: 'gap', evidenceItemId: null },
  ],
  bank: [
    { id: 'uuid-1', title: 'Cut costs', body: 'Cut query spend.', context: null, metrics: '40%' },
    {
      id: 'uuid-2',
      title: 'Migrated warehouse',
      body: 'Moved 300 tables.',
      context: 'At Foo',
      metrics: null,
    },
  ],
  profile: { writingStyleNotes: 'Short sentences.', banned: ['passionate'] },
};

describe('renderBank', () => {
  it('names each item by a short ref and maps it back to its id', () => {
    const { text, refs } = renderBank(context.bank);
    expect(text).toContain('[e1] Cut costs');
    expect(text).toContain('Numbers: 40%');
    expect(text).toContain('[e2] Migrated warehouse');
    expect(refs.get('e2')).toBe('uuid-2');
  });
});

describe('roleReplyMessage', () => {
  const { refs } = renderBank(context.bank);

  it('cites the matched bank item by its ref, and says what is not on file', () => {
    const message = roleReplyMessage(context, [], 'write my cover letter', refs);
    expect(message).toContain('Role: Data Engineer at Acme');
    expect(message).toContain('(must have, strong, e2) Warehouse migrations');
    expect(message).toContain('(nice to have, gap) Kafka');
    expect(message).toContain('There is no cover letter on file.');
    expect(message).toContain('Never use these: passionate');
    expect(message.endsWith('Their comment:\nwrite my cover letter')).toBe(true);
  });

  it('carries the thread with who said each turn', () => {
    const message = roleReplyMessage(
      context,
      [
        { author: 'me', body: 'Recruiter is Sam.' },
        { author: 'claude', body: 'Noted.' },
      ],
      'what next?',
      refs,
    );
    expect(message).toContain('Them: Recruiter is Sam.\n\nDash: Noted.');
  });
});

describe('parseRoleReply', () => {
  const { refs } = renderBank(context.bank);

  it('keeps an answer with no letter', () => {
    expect(parseRoleReply({ answer: 'Apply this week.' }, refs, [])).toEqual({
      kind: 'reply',
      answer: 'Apply this week.',
      coverLetter: null,
      evidenceItemIds: [],
      unsupportedClaims: [],
    });
  });

  it('maps the letter refs back to ids and drops refs it never sent', () => {
    const reply = parseRoleReply(
      {
        answer: 'Written.',
        cover_letter: 'Dear team,\n\nI moved 300 tables.',
        evidence_refs: ['e2', 'e9', 'e2'],
        unsupported_claims: ['team of 12'],
      },
      refs,
      [],
    );
    expect(reply).toMatchObject({
      kind: 'reply',
      evidenceItemIds: ['uuid-2'],
      unsupportedClaims: ['team of 12'],
    });
  });

  it('refuses a letter that uses a construction they ruled out', () => {
    const reply = parseRoleReply(
      { answer: '', cover_letter: 'I am Passionate about data.' },
      refs,
      ['passionate'],
    );
    expect(reply).toEqual({
      kind: 'error',
      error: 'The letter used "passionate", which you have ruled out, so it was not filed.',
    });
  });

  it('refuses an empty reply and a letter too long for the field', () => {
    expect(parseRoleReply({ answer: '  ' }, refs, []).kind).toBe('error');
    expect(parseRoleReply(null, refs, []).kind).toBe('error');
    expect(
      parseRoleReply({ answer: 'x', cover_letter: 'a'.repeat(COVER_LETTER_MAX + 1) }, refs, [])
        .kind,
    ).toBe('error');
  });
});

describe('replyBody', () => {
  const reply = {
    kind: 'reply' as const,
    answer: '',
    coverLetter: 'New letter.',
    evidenceItemIds: [],
    unsupportedClaims: ['led a team of 12'],
  };

  it('says where the letter went and what to check', () => {
    const body = replyBody(reply, null);
    expect(body).toContain('I wrote a cover letter. It is under Application.');
    expect(body).toContain('- led a team of 12');
    expect(body).not.toContain('The letter it replaced');
  });

  it('keeps the letter it replaced in the thread', () => {
    const body = replyBody(reply, 'Old letter.');
    expect(body).toContain('I rewrote the cover letter.');
    expect(body.endsWith('The letter it replaced:\n\nOld letter.')).toBe(true);
  });

  it('is only the answer when no letter was written', () => {
    expect(replyBody({ ...reply, answer: 'Apply now.', coverLetter: null }, 'Old')).toBe(
      'Apply now.',
    );
  });
});
