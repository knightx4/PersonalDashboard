import { describe, expect, it } from 'vitest';
import { asksEverywhere } from './everywhere';

describe('asksEverywhere', () => {
  it('marks a note that asks for the change on every page', () => {
    for (const body of [
      'let me collapse the recommended roles and any similar boxes anywhere else',
      'Times should be 12-hour everywhere',
      'links should work... really anywhere like it',
      'Do this on every page please',
      'same for all the screens',
      'fix the spacing across the app',
      'Any other list should do this too',
    ]) {
      expect(asksEverywhere(body), body).toBe(true);
    }
  });

  it('leaves a note about one page alone', () => {
    for (const body of [
      'The save button on the role page does nothing',
      'Somewhere on this page the total is wrong',
      'every time I open it the list is empty',
      'Show all the roles on one page',
    ]) {
      expect(asksEverywhere(body), body).toBe(false);
    }
  });
});
