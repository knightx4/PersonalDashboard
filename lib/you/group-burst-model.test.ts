import { describe, expect, it } from 'vitest';
import {
  askOf,
  asksPerson,
  capsFor,
  cleanSpeech,
  directorPlanOf,
  directorPrompt,
  groupCaps,
  isPass,
  MIN_BOT_MESSAGES,
  mentionedIn,
  OPEN_ASK,
  quietestFirst,
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
    expect(MIN_BOT_MESSAGES).toBe(6);
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

const EIGHT: BurstMember[] = ['Ada Lovelace', 'Ben Franklin', 'Cy Twombly', 'Dee Rams', 'Eve Curie', 'Fay Wray', 'Gus Grissom', 'Hal Abelson'].map((name) => ({
  id: name[0].toLowerCase(),
  key: name.split(' ')[0].toLowerCase(),
  name,
}));
const everyPick = (members: readonly BurstMember[], why: 'answer' | 'question' = 'answer'): DirectorPlan => ({
  wait: false,
  picks: members.map((m) => ({ key: m.key, why })),
  reactions: [],
});

describe('caps that scale with the group (plan #3080)', () => {
  it('keeps three and six for two to six bots, and grows to half the group and twice that', () => {
    expect([2, 3, 4, 5, 6].map(groupCaps)).toEqual(Array(5).fill({ openers: 3, messages: 6 }));
    expect(groupCaps(7)).toEqual({ openers: 4, messages: 8 });
    expect(groupCaps(8)).toEqual({ openers: 4, messages: 8 });
    expect(groupCaps(12)).toEqual({ openers: 6, messages: 12 });
  });

  it('widens the caps so everyone addressed answers, with room for a couple of replies', () => {
    expect(capsFor(8, askOf('Everyone say one thing', EIGHT))).toEqual({ openers: 8, messages: 10 });
    expect(capsFor(8, OPEN_ASK)).toEqual({ openers: 4, messages: 8 });
  });

  it('lets up to half of a group of eight answer an ordinary message, none twice in a row', () => {
    expect(planTurns(everyPick(EIGHT), { round: 0, spoken: [] }, EIGHT)).toEqual(['a', 'b', 'c', 'd']);
    expect(planTurns(everyPick(EIGHT, 'question'), { round: 1, spoken: ['a', 'b', 'c', 'd'] }, EIGHT)).toEqual(['a', 'b', 'c']);
    expect(planTurns(everyPick(EIGHT, 'question'), { round: 2, spoken: ['a', 'b', 'c', 'd', 'a', 'b', 'c'] }, EIGHT)).toEqual(['d']);
  });

  it('gives every bot one turn when the person speaks to everyone, in the director\'s order and then the rest', () => {
    const ask = askOf('Everyone say one thing', EIGHT);
    const plan: DirectorPlan = { wait: false, picks: [{ key: 'gus', why: 'answer' }, { key: 'cy', why: 'answer' }], reactions: [] };
    expect(planTurns(plan, { round: 0, spoken: [] }, EIGHT, ask)).toEqual(['g', 'c', 'a', 'b', 'd', 'e', 'f', 'h']);
    // Even when the director would wait.
    expect(planTurns({ wait: true, picks: [], reactions: [] }, { round: 0, spoken: [] }, EIGHT, ask)).toHaveLength(8);
  });

  it('gives each bot the person named one turn in the order named, and nobody else', () => {
    const ask = askOf('Hal, Ada and Eve: one word each', EIGHT);
    expect(ask.addressed).toEqual(['h', 'a', 'e']);
    expect(planTurns(everyPick(EIGHT), { round: 0, spoken: [] }, EIGHT, ask)).toEqual(['h', 'a', 'e']);
  });

  it('does not give an addressed bot a second turn when a chained request carries the round on, and holds one back rather than twice in a row', () => {
    const ask = askOf('everyone, go around', EIGHT);
    expect(planTurns(everyPick(EIGHT), { round: 0, spoken: ['a', 'b', 'c'] }, EIGHT, ask)).toEqual(['d', 'e', 'f', 'g', 'h']);
    const three = EIGHT.slice(0, 3);
    expect(planTurns(everyPick(three), { round: 0, spoken: ['a'] }, three, askOf('all of you', three))).toEqual(['b', 'c']);
    expect(planTurns(everyPick(three), { round: 0, spoken: ['x'] }, three, askOf('all of you', three))).toEqual(['a', 'b', 'c']);
  });

  it('carries on from the quietest when the person says keep going and the director picks nobody', () => {
    const ask = askOf('keep going', EIGHT);
    expect(ask.keepGoing).toBe(true);
    const lines = [
      { id: '1', speakerId: 'a', text: 'x' },
      { id: '2', speakerId: 'c', text: 'y' },
      { id: '3', speakerId: null, text: 'keep going' },
    ];
    const order = quietestFirst(lines, EIGHT);
    expect(order.slice(0, 2)).toEqual(['b', 'd']);
    expect(order.slice(-2)).toEqual(['a', 'c']);
    expect(planTurns({ wait: true, picks: [], reactions: [] }, { round: 0, spoken: [] }, EIGHT, ask, order)).toEqual(['b', 'd', 'e', 'f']);
  });

  it('tells the director how many may answer and who was spoken to', () => {
    const cards = EIGHT.map((m) => ({ ...m, card: '' }));
    expect(directorPrompt({ members: cards, transcript: '', state: { round: 0, spoken: [] } })).toContain('Up to 4 bots may answer');
    expect(directorPrompt({ members: cards, transcript: '', state: { round: 0, spoken: [] }, ask: askOf('everyone say one thing', EIGHT) })).toContain(
      'all 8 bots answer once each',
    );
  });
});

describe('who the person is speaking to (plan #3080)', () => {
  it('reads a message to everyone', () => {
    for (const text of ['Everyone say one thing', 'hey everyone, quick one', 'What does everyone think?', 'Each of you pick a film', 'all of you: go', "let's go around", 'one thing from everybody.', "y'all ready?"]) {
      expect(askOf(text, EIGHT).everyone, text).toBe(true);
    }
  });

  it('does not read a sentence about other people as one to everyone', () => {
    for (const text of ['everyone at work hates me', 'I told everybody about the move last week', 'Is it normal that everyone else seems sure?']) {
      expect(askOf(text, EIGHT).everyone, text).toBe(false);
    }
  });

  it('reads keep going, carry on and continue, and not a longer message that holds them', () => {
    for (const text of ['keep going', 'Carry on!', 'ok continue', 'go on', 'yes, keep going please']) expect(askOf(text, EIGHT).keepGoing, text).toBe(true);
    for (const text of ['I want to keep going with the job search but I am tired', 'should I continue?']) expect(askOf(text, EIGHT).keepGoing, text).toBe(false);
  });

  it('addresses one named bot as before, without the everyone rule', () => {
    expect(askOf('Ada, what do you think?', EIGHT)).toMatchObject({ named: ['a'], addressed: [], everyone: false });
  });

  it('reads a pass, and only a pass', () => {
    for (const text of ['PASS', 'pass.', '(pass)', '**PASS**']) expect(isPass(text), text).toBe(true);
    for (const text of ['Pass the salt', 'I would pass on that job']) expect(isPass(text), text).toBe(false);
  });
});
