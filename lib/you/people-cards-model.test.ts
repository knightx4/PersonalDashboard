import { describe, expect, it } from 'vitest';
import { MENTOR_PALETTE } from '@/lib/you/chat-threads-model';
import {
  briefOf,
  canTalkOf,
  cleanPersonForm,
  colourAllowed,
  contrastWithWhite,
  DRAFT_TOOL,
  draftedCard,
  draftPrompt,
  draftReady,
  EMPTY_BRIEF,
  newPersonCard,
  PERSONA_MAX,
  versionOf,
  WHITE_CONTRAST_MIN,
} from '@/lib/you/people-cards-model';

const form = (over: Record<string, unknown> = {}) => ({
  name: '  Aunt   Margaret ',
  colour: MENTOR_PALETTE[0],
  brief: { who: 'My aunt', length: 'short', bubbles: 'few', tone: 'Blunt', cares: 'Sleep', never: 'Jargon' },
  persona: 'You are Aunt Margaret.',
  joinsMeetings: false,
  ...over,
});

describe('colours', () => {
  it('carries white initials at 4.5:1 for every palette colour', () => {
    for (const c of MENTOR_PALETTE) expect(contrastWithWhite(c)).toBeGreaterThanOrEqual(WHITE_CONTRAST_MIN);
  });

  it('allows the palette and dark colours, and refuses light ones and junk', () => {
    expect(colourAllowed(MENTOR_PALETTE[3])).toBe(true);
    expect(colourAllowed('#1a1a1a')).toBe(true);
    expect(colourAllowed('#f5d76e')).toBe(false);
    expect(colourAllowed('#ffffff')).toBe(false);
    expect(colourAllowed('red')).toBe(false);
  });
});

describe('cleanPersonForm', () => {
  it('trims the name and keeps the form', () => {
    const r = cleanPersonForm(form());
    expect(r.ok && r.value.name).toBe('Aunt Margaret');
    expect(r.ok && r.value.brief.tone).toBe('Blunt');
    expect(r.ok && r.value.joinsMeetings).toBe(false);
  });

  it('refuses a form with no name, a light colour or no card', () => {
    expect(cleanPersonForm(form({ name: ' ' }))).toEqual({ ok: false, error: 'Give them a name first.' });
    expect(cleanPersonForm(form({ colour: '#ffffff' }))).toEqual({ ok: false, error: 'Pick one of the colours.' });
    expect(cleanPersonForm(form({ persona: '' }))).toEqual({ ok: false, error: 'Write their card, or have Dash draft it.' });
    expect(cleanPersonForm(form({ persona: 'x'.repeat(PERSONA_MAX + 1) })).ok).toBe(false);
  });
});

describe('briefOf', () => {
  it('reads a stored brief, and falls back to the focus for who they are', () => {
    expect(briefOf(null)).toEqual(EMPTY_BRIEF);
    expect(briefOf({ length: 'long', bubbles: 'nonsense' }, 'Money and habits')).toEqual({
      ...EMPTY_BRIEF,
      who: 'Money and habits',
      length: 'long',
    });
  });
});

describe('drafting', () => {
  it('needs a name and something about them before a first draft', () => {
    expect(draftReady('', EMPTY_BRIEF)).toBe('Give them a name first.');
    expect(draftReady('Margaret', EMPTY_BRIEF)).toMatch(/Say who they are/);
    expect(draftReady('Margaret', { ...EMPTY_BRIEF, tone: 'Blunt' })).toBeNull();
  });

  it('asks for a card from the form, or a rewrite of the current one from a sentence', () => {
    const brief = { ...EMPTY_BRIEF, who: 'My aunt', tone: 'Blunt' };
    const first = draftPrompt({ name: 'Margaret', brief });
    expect(first).toContain('Who they are: My aunt');
    expect(first).toContain("Write Margaret's card from this form.");
    expect(first).toContain(DRAFT_TOOL);
    const again = draftPrompt({ name: 'Ben', brief, current: 'You are Ben.', ask: 'blunter and shorter' });
    expect(again).toContain('<card>\nYou are Ben.\n</card>');
    expect(again).toContain('keeping what the ask does not touch: blunter and shorter');
  });

  it('keeps the card Dash wrote, cut to the column', () => {
    expect(draftedCard({ card: '  You are Ben.  ' })).toBe('You are Ben.');
    expect(draftedCard({ card: '' })).toBeNull();
    expect(draftedCard(null)).toBeNull();
    expect(draftedCard({ card: 'x'.repeat(PERSONA_MAX + 50) })).toHaveLength(PERSONA_MAX);
  });
});

describe('the edit page', () => {
  it('reads an earlier card', () => {
    expect(versionOf({ id: 'v1', persona: 'Card', made_by: 'dash', ask: 'shorter', created_at: '2026-11-01' })).toEqual({
      id: 'v1',
      persona: 'Card',
      madeBy: 'dash',
      ask: 'shorter',
      createdAt: '2026-11-01',
    });
    expect(versionOf({ id: 'v2', persona: '' })).toBeNull();
  });

  it('starts someone new on a colour nobody uses, in Chat only', () => {
    const card = newPersonCard([MENTOR_PALETTE[0], MENTOR_PALETTE[1]]);
    expect(card.colour).toBe(MENTOR_PALETTE[2]);
    expect(card.joinsMeetings).toBe(false);
    expect(card.madeByYou).toBe(true);
  });

  it('lets someone of your own talk once they have a card', () => {
    expect(canTalkOf({ kind: 'guest', brainStatus: 'none', madeByYou: true, hasPersona: true })).toBe(true);
    expect(canTalkOf({ kind: 'guest', brainStatus: 'none', madeByYou: true, hasPersona: false })).toBe(false);
    expect(canTalkOf({ kind: 'guest', brainStatus: 'none', madeByYou: false, hasPersona: true })).toBe(false);
    expect(canTalkOf({ kind: 'seat', brainStatus: 'none' })).toBe(true);
  });
});
