/**
 * No test reaches Voyage.
 *
 * Every route that saves a Learn idea embeds its claim as it writes
 * (lib/learn/embed/idea-embedding.ts), and `embedTexts` falls back to
 * EMBEDDING_API_KEY. On a machine where the key is set, a test of any of those
 * writers would otherwise make a real call and spend. Cleared here, so a test
 * gets the no-key answer unless it stubs the key or the call itself.
 */
delete process.env.EMBEDDING_API_KEY;
