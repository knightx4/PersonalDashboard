import { describe, expect, it } from 'vitest';
import { bareRef, isUuid } from '@/lib/ask/db';

const ID = 'dd9fb10f-0c4c-4ef6-bbea-0db005ad6555';

describe('bareRef', () => {
  it('leaves a bare id alone', () => {
    expect(bareRef(ID)).toBe(ID);
  });

  it('strips the table the model wrote in front of an id (turn 08ee48b0)', () => {
    expect(isUuid(bareRef(`job_search.application_answers:${ID}`))).toBe(true);
  });

  it('leaves text that is not a ref for the caller to refuse', () => {
    expect(bareRef('the first answer')).toBe('the first answer');
  });
});
