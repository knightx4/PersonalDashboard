import { describe, expect, it } from 'vitest';
import { roleFromText } from './role';
import { quizFromText, topicFromText } from './learn-text';

describe('a role typed into capture', () => {
  it('takes a posting link alone, for the page to fill the rest', () => {
    expect(roleFromText('https://jobs.ashbyhq.com/sent/123')).toEqual({
      url: 'https://jobs.ashbyhq.com/sent/123',
      title: '',
      company: '',
    });
  });

  it('keeps a role and company written around a link', () => {
    expect(roleFromText('Analyst at Ramp https://ramp.com/careers/9.')).toEqual({
      url: 'https://ramp.com/careers/9',
      title: 'Analyst',
      company: 'Ramp',
    });
  });

  it('splits a sentence at its last "at", so a title with a comma survives', () => {
    expect(roleFromText('Senior Analyst, Payments at Ramp')).toEqual({
      url: null,
      title: 'Senior Analyst, Payments',
      company: 'Ramp',
    });
    expect(roleFromText('Product Manager - Stripe')).toEqual({ url: null, title: 'Product Manager', company: 'Stripe' });
  });

  it('says how to write it when a sentence names only one of the two', () => {
    expect(roleFromText('Strategic Finance Analyst')).toHaveProperty('error');
  });
});

describe('a topic typed into capture', () => {
  it('names the topic from the first line and reads the lines under it as readings', () => {
    const topic = topicFromText('Central banking\n- The Lords of Finance by Liaquat Ahamed\n- https://example.com/rates');
    expect(topic).toMatchObject({ title: 'Central banking' });
    if ('error' in topic) throw new Error(topic.error);
    expect(topic.readings).toHaveLength(2);
    expect(topic.readings[1]!.title).toContain('https://example.com/rates');
  });

  it('takes a name with nothing under it', () => {
    expect(topicFromText('  \nCentral banking\n')).toEqual({ title: 'Central banking', readings: [] });
  });

  it('refuses an empty field', () => {
    expect(topicFromText('   ')).toHaveProperty('error');
  });
});

describe('a quiz typed into capture', () => {
  it('reads [[Note title]] as a note and the rest as pasted material', () => {
    expect(quizFromText('[[Monetary policy]], [[Rates|the rates note]]')).toEqual({
      paste: '',
      notes: ['Monetary policy', 'Rates'],
    });
    expect(quizFromText('The Fed sets the rate.\n[[Monetary policy]]')).toEqual({
      paste: 'The Fed sets the rate.',
      notes: ['Monetary policy'],
    });
  });

  it('asks for something to be quizzed on', () => {
    expect(quizFromText('[[ ]]')).toHaveProperty('error');
  });
});
