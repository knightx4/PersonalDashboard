import { describe, expect, it } from 'vitest';
import {
  asksPerson,
  cleanSpeech,
  directorPlanOf,
  MAX_BOT_MESSAGES,
  mentionedIn,
  planReactions,
  planTurns,
  transcriptOf,
  type BurstMember,
  type DirectorPlan,
} from '@/lib/you/group-burst-model';

const M: BurstMember[] = [
  { id: 'a', key: 'ada', name: 'Ada Lovelace' },
  { id: 'b', key: 'ben', name: 'Ben Franklin' },
  { id: 'c', key: 'cy', name: 'Cy Twombly' },
  { id: 'd', key: 'dee', name: 'Dee Rams' },
];

const all = (why: 'answer' | 'question' | 'agree' = 'answer'): DirectorPlan => ({
  wait: false,
  picks: M.map((m) => ({ key: m.key, why: why as 'answer' })),
  reactions: [],
});

describe('planTurns (plan #2879.1.2)', () => {
  it('lets at most three answer the person', () => {
    expect(planTurns(all(), { round: 0, spoken: [] }, M)).toEqual(['a', 'b', 'c']);
  });

  it('puts a bot the person named first, even when the director would wait', () => {
    expect(planTurns(all(), { round: 0, spoken: [] }, M, ['d'])).toEqual(['d', 'a', 'b']);
    expect(planTurns({ wait: true, picks: [], reactions: [] }, { round: 0, spoken: [] }, M, ['c'])).toEqual(['c']);
  });

  it('lets a bot answer a bot only for a question, a disagreement or a correction', () => {
    const plan: DirectorPlan = {
      wait: false,
      picks: [
        { key: 'ada', why: 'answer' },
        { key: 'ben', why: 'disagreement' },
      ],
      reactions: [],
    };
    expect(planTurns(plan, { round: 1, spoken: ['c'] }, M)).toEqual(['b']);
  });

  it('stops after two rounds of bots answering bots', () => {
    expect(planTurns(all('question'), { round: 3, spoken: ['a'] }, M)).toEqual([]);
  });

  it('never lets a bot speak twice in a row or more than twice', () => {
    expect(planTurns(all('question'), { round: 1, spoken: ['a', 'b', 'a'] }, M)).toEqual(['b', 'c', 'd']);
    expect(planTurns({ wait: false, picks: [{ key: 'ben', why: 'question' }], reactions: [] }, { round: 1, spoken: ['a', 'b'] }, M)).toEqual([]);
    expect(planTurns({ wait: false, picks: [{ key: 'ada', why: 'question' }], reactions: [] }, { round: 2, spoken: ['a', 'b', 'a'] }, M)).toEqual([]);
  });

  it('never goes past six bot messages', () => {
    expect(planTurns(all('question'), { round: 2, spoken: ['a', 'b', 'c', 'd', 'a'] }, M)).toEqual(['b']);
    expect(planTurns(all('question'), { round: 2, spoken: ['a', 'b', 'c', 'd', 'a', 'b'] }, M)).toHaveLength(0);
    expect(MAX_BOT_MESSAGES).toBe(6);
  });

  it('ignores a pick that is not a member', () => {
    expect(planTurns({ wait: false, picks: [{ key: 'zed', why: 'answer' }], reactions: [] }, { round: 0, spoken: [] }, M)).toEqual([]);
  });
});

describe('who is named and who is asked', () => {
  it('finds a bot by @first name, first name or full name, in order', () => {
    expect(mentionedIn('@ben what about you, and Ada?', M)).toEqual(['b', 'a']);
    expect(mentionedIn('Cy Twombly would know', M)).toEqual(['c']);
    expect(mentionedIn('benefits matter', M)).toEqual([]);
  });

  it('reads a question naming nobody as a question to the person', () => {
    expect(asksPerson('What would you do?', 'a', M)).toBe(true);
    expect(asksPerson('Ben, would you do that?', 'a', M)).toBe(false);
    expect(asksPerson('I would do it.', 'a', M)).toBe(false);
  });
});

describe('reading the director', () => {
  it('reads a malformed answer as waiting', () => {
    expect(directorPlanOf(null).wait).toBe(true);
    expect(directorPlanOf({ wait: false, speakers: [] }).wait).toBe(true);
    expect(directorPlanOf({ wait: false, speakers: [{ bot: 'ada', why: 'banter' }], reactions: [{ bot: 'ben', line: 2, reaction: 'shrug' }] })).toEqual({
      wait: false,
      picks: [{ key: 'ada', why: 'answer' }],
      reactions: [],
    });
  });

  it('keeps reactions to real lines by other bots, one per bot per line', () => {
    const lines = [
      { id: 'm1', speakerId: null, text: 'Hi' },
      { id: 'm2', speakerId: 'a', text: 'Hello' },
    ];
    const plan: DirectorPlan = {
      wait: true,
      picks: [],
      reactions: [
        { key: 'ben', line: 2, reaction: 'heart' },
        { key: 'ben', line: 2, reaction: 'laugh' },
        { key: 'ada', line: 2, reaction: 'heart' },
        { key: 'cy', line: 9, reaction: 'heart' },
      ],
    };
    expect(planReactions(plan, lines, M)).toEqual([{ advisorId: 'b', messageId: 'm2', reaction: 'heart' }]);
  });
});

describe('the transcript and a bot text', () => {
  it('numbers lines and names who said each', () => {
    expect(transcriptOf([{ id: '1', speakerId: null, text: 'Hi' }, { id: '2', speakerId: 'a', text: 'Hey' }, { id: '3', speakerId: 'x', text: 'Yo' }], M)).toBe(
      '[1] The person: Hi\n[2] Ada Lovelace: Hey\n[3] Someone who left: Yo',
    );
  });

  it('takes a bot name off the front of its own text', () => {
    expect(cleanSpeech('Ada Lovelace: "Sounds good."', 'Ada Lovelace')).toBe('Sounds good.');
    expect(cleanSpeech('   ', 'Ada')).toBeNull();
  });
});
