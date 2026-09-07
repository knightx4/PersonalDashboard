import { describe, expect, it } from 'vitest';
import {
  challengeResponse,
  ebayDeletionEndpointUrl,
  EBAY_DELETION_PATH,
  isValidVerificationToken,
} from './account-deletion';

const CODE = 'abc123';
const TOKEN = 'Shelf_Manager_Verification_Token_2026';
const ENDPOINT = 'https://example.com/api/ebay/account-deletion';

describe('challengeResponse', () => {
  it('matches a hash computed independently of this implementation', () => {
    // sha256("abc123" + token + endpoint), from python hashlib -- a fixture
    // rather than a round trip, so a change to the concatenation order fails.
    expect(challengeResponse({ challengeCode: CODE, verificationToken: TOKEN, endpoint: ENDPOINT }))
      .toBe('9d9a32f7f17d3b7608d0befdd3670d348a2776890ad3eaf0e52fa8a537ac0e0f');
  });

  it('is order-sensitive, so token-first would not pass validation', () => {
    const swapped = challengeResponse({
      challengeCode: TOKEN,
      verificationToken: CODE,
      endpoint: ENDPOINT,
    });
    expect(swapped).toBe('f8c28458147a36902e1c9d01e5e3ef68be92c6f1463edc0e424475ec0526f14d');
    expect(swapped).not.toBe(
      challengeResponse({ challengeCode: CODE, verificationToken: TOKEN, endpoint: ENDPOINT }),
    );
  });

  it('changes when the endpoint differs by even a trailing slash', () => {
    const base = { challengeCode: CODE, verificationToken: TOKEN };
    expect(challengeResponse({ ...base, endpoint: ENDPOINT })).not.toBe(
      challengeResponse({ ...base, endpoint: `${ENDPOINT}/` }),
    );
  });
});

describe('isValidVerificationToken', () => {
  it('accepts eBay\'s range and rejects what it will not take', () => {
    expect(isValidVerificationToken('a'.repeat(32))).toBe(true);
    expect(isValidVerificationToken('a'.repeat(80))).toBe(true);
    expect(isValidVerificationToken(`${'a'.repeat(28)}_-9Z`)).toBe(true);

    expect(isValidVerificationToken('a'.repeat(31))).toBe(false);
    expect(isValidVerificationToken('a'.repeat(81))).toBe(false);
    // A token with punctuation is the kind of thing a password generator emits.
    expect(isValidVerificationToken(`${'a'.repeat(31)}!`)).toBe(false);
    expect(isValidVerificationToken(null)).toBe(false);
    expect(isValidVerificationToken(undefined)).toBe(false);
  });
});

describe('ebayDeletionEndpointUrl', () => {
  it('derives the URL from the app URL', () => {
    expect(ebayDeletionEndpointUrl({ appUrl: 'https://shelf.example.com' })).toBe(
      `https://shelf.example.com${EBAY_DELETION_PATH}`,
    );
  });

  it('does not double the slash when the app URL carries one', () => {
    expect(ebayDeletionEndpointUrl({ appUrl: 'https://shelf.example.com/' })).toBe(
      `https://shelf.example.com${EBAY_DELETION_PATH}`,
    );
  });

  it('prefers an explicit override, so a custom domain can be registered', () => {
    expect(
      ebayDeletionEndpointUrl({
        configuredUrl: 'https://other.example.com/hook/',
        appUrl: 'https://shelf.example.com',
      }),
    ).toBe('https://other.example.com/hook');
  });

  it('ignores an override that is only whitespace', () => {
    expect(
      ebayDeletionEndpointUrl({ configuredUrl: '   ', appUrl: 'https://shelf.example.com' }),
    ).toBe(`https://shelf.example.com${EBAY_DELETION_PATH}`);
  });
});
