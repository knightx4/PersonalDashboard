import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_TITLE } from './lookup';
import { PLACEHOLDER_ROLE_TITLE } from '@/lib/jobs/inbox/ingest-messages';

/**
 * The placeholder title is written by ingestion and read by the lookup, and the
 * two hold it separately: importing the constant from the inbox module would
 * pull the whole ingestion pipeline — the Gmail client, the model SDK — into a
 * server action whose job is to render a button.
 *
 * That is a defensible trade only while this test exists. If the two drift, the
 * lookup silently starts treating "Role from email" as a real job title, offers
 * it to board discovery as evidence, and confirms a guessed board against a
 * title no employer ever posted.
 */
describe('the placeholder title', () => {
  it('is the same string ingestion writes', () => {
    expect(PLACEHOLDER_TITLE).toBe(PLACEHOLDER_ROLE_TITLE);
  });
});
