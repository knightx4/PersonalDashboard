import { describe, expect, it } from 'vitest';
import { linkedinHref, whyNotSaved } from './details';

describe('linkedinHref', () => {
  it('keeps an address typed with http or https', () => {
    expect(linkedinHref('https://www.linkedin.com/in/someone')).toBe('https://www.linkedin.com/in/someone');
    expect(linkedinHref('HTTP://linkedin.com/in/someone')).toBe('HTTP://linkedin.com/in/someone');
  });

  it('puts https in front of an address typed without a scheme', () => {
    expect(linkedinHref(' linkedin.com/in/someone ')).toBe('https://linkedin.com/in/someone');
  });

  it('never opens anything but https for another scheme', () => {
    expect(linkedinHref('javascript:alert(1)')).toBe('https://alert(1)');
  });
});

describe('whyNotSaved', () => {
  it('says a dropped connection can be tried again', () => {
    expect(whyNotSaved(new Error('Saving your details failed: TypeError: fetch failed'))).toMatch(/connection dropped/);
  });

  it('names what the database refused', () => {
    expect(whyNotSaved(new Error('Saving your details failed: new row violates check constraint "details_phone_check".'))).toBe(
      'The database refused these details (new row violates check constraint "details_phone_check"). What you typed is still here.',
    );
  });
});
