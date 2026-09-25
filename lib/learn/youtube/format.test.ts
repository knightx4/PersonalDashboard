import { describe, expect, it } from 'vitest';
import { clockTime, durationLabel, embedUrl, watchAt, youtubeVideoId } from '@/lib/learn/youtube/format';

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

describe('youtubeVideoId', () => {
  it('reads the id from every shape of video link', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=TSdXJw83kyA')).toBe('TSdXJw83kyA');
    expect(youtubeVideoId('https://www.youtube.com/watch?v=TSdXJw83kyA&t=1468s')).toBe('TSdXJw83kyA');
    expect(youtubeVideoId('https://m.youtube.com/watch?v=TSdXJw83kyA')).toBe('TSdXJw83kyA');
    expect(youtubeVideoId('https://youtu.be/TSdXJw83kyA?t=90')).toBe('TSdXJw83kyA');
    expect(youtubeVideoId('https://www.youtube-nocookie.com/embed/TSdXJw83kyA?start=5')).toBe('TSdXJw83kyA');
    expect(youtubeVideoId('https://www.youtube.com/shorts/TSdXJw83kyA')).toBe('TSdXJw83kyA');
  });

  it('gives null for anything that is not one video', () => {
    expect(youtubeVideoId(null)).toBeNull();
    expect(youtubeVideoId('')).toBeNull();
    expect(youtubeVideoId('not a url')).toBeNull();
    expect(youtubeVideoId('https://en.wikipedia.org/wiki/Eigenvalues_and_eigenvectors')).toBeNull();
    expect(youtubeVideoId('https://www.youtube.com/@mitocw')).toBeNull();
    expect(youtubeVideoId('https://www.youtube.com/playlist?list=PL49CF3715CB9EF31D')).toBeNull();
    expect(youtubeVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(youtubeVideoId('https://notyoutube.com/watch?v=TSdXJw83kyA')).toBeNull();
  });
});
