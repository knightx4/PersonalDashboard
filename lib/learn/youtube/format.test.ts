import { describe, expect, it } from 'vitest';
import { clockTime, durationLabel, embedUrl, watchAt } from '@/lib/learn/youtube/format';

describe('clockTime', () => {
  it('writes minutes and seconds, and hours only when there are some', () => {
    expect(clockTime(0)).toBe('0:00');
    expect(clockTime(75)).toBe('1:15');
    expect(clockTime(3725)).toBe('1:02:05');
    expect(clockTime(8.9)).toBe('0:08');
  });
});

describe('durationLabel', () => {
  it('says nothing for a length YouTube did not give', () => {
    expect(durationLabel(null)).toBeNull();
    expect(durationLabel(2340)).toBe('39:00');
  });
});

describe('embedUrl', () => {
  it('plays exactly the span asked for', () => {
    expect(embedUrl('ZK3O402wf1c', 754, 1012.4)).toBe(
      'https://www.youtube-nocookie.com/embed/ZK3O402wf1c?start=754&end=1013&rel=0',
    );
  });

  it('leaves out a start of zero and an end before the start', () => {
    expect(embedUrl('ZK3O402wf1c', 0)).toBe('https://www.youtube-nocookie.com/embed/ZK3O402wf1c?rel=0');
    expect(embedUrl('ZK3O402wf1c', 300, 200)).toBe(
      'https://www.youtube-nocookie.com/embed/ZK3O402wf1c?start=300&rel=0',
    );
  });
});

describe('watchAt', () => {
  it('opens the video at a second', () => {
    expect(watchAt('ZK3O402wf1c', 754.6)).toBe('https://www.youtube.com/watch?v=ZK3O402wf1c&t=754s');
  });
});
