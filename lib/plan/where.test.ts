import { describe, expect, it } from 'vitest';
import { whereToDoIt } from './where';

describe('whereToDoIt', () => {
  it('takes a full URL first, without the full stop after it', () => {
    expect(
      whereToDoIt('Add the key at https://console.anthropic.com/settings/keys. Then press.'),
    ).toEqual({
      href: 'https://console.anthropic.com/settings/keys',
      label: 'console.anthropic.com',
      external: true,
    });
  });

  it('reads a path inside the app out of the instructions', () => {
    expect(
      whereToDoIt(
        'On the Thermodynamics subject page (/learn/s/ea8c4374-481d-416d-a7f6-5905855a77f0), paste it.',
      ),
    ).toEqual({
      href: '/learn/s/ea8c4374-481d-416d-a7f6-5905855a77f0',
      label: 'Open the page',
      external: false,
    });
  });

  it('does not read a file path as a page', () => {
    expect(
      whereToDoIt('A migration in supabase/migrations-news and app/dev/plan/page.tsx'),
    ).toMatchObject({
      label: 'Supabase',
    });
    expect(whereToDoIt('Edit app/dev/plan/page.tsx')).toBeNull();
  });

  it('names the service mentioned first', () => {
    expect(
      whereToDoIt(
        'Both in the Mailgun dashboard. Set MAILGUN_API_KEY in the Vercel project settings.',
      ),
    ).toEqual({ href: 'https://app.mailgun.com', label: 'Mailgun', external: true });
  });

  it('draws nothing when the text names no place', () => {
    expect(whereToDoIt('Decide which of the two you want.')).toBeNull();
    expect(whereToDoIt(null)).toBeNull();
  });
});
