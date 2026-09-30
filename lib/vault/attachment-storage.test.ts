import { describe, expect, it } from 'vitest';
import { removeAttachmentFolder, vaultAttachmentFolder } from '@/lib/vault/attachment-storage';
import { VAULT_ATTACHMENTS_BUCKET } from '@/lib/vault/paths';
import { fakeStorage } from '../../tests/stubs/fake-storage';

describe('vaultAttachmentFolder', () => {
  it('names the connection folder inside the account folder', () => {
    expect(vaultAttachmentFolder('user-1', 'conn-1')).toBe('user-1/conn-1');
    expect(vaultAttachmentFolder('user-1')).toBe('user-1');
  });

  it('refuses an empty user id, which would name the whole bucket', () => {
    expect(() => vaultAttachmentFolder('')).toThrow();
  });
});

describe('removeAttachmentFolder', () => {
  it('removes one connection and leaves the others and other accounts alone', async () => {
    const store = fakeStorage({
      [VAULT_ATTACHMENTS_BUCKET]: [
        'user-1/conn-1/aaa',
        'user-1/conn-1/bbb',
        'user-1/conn-2/ccc',
        'user-2/conn-9/ddd',
      ],
    });

    const removed = await removeAttachmentFolder(store.client, 'user-1/conn-1');

    expect(removed.sort()).toEqual(['user-1/conn-1/aaa', 'user-1/conn-1/bbb']);
    expect(store.left(VAULT_ATTACHMENTS_BUCKET)).toEqual(['user-1/conn-2/ccc', 'user-2/conn-9/ddd']);
  });

  it('walks into each connection when given the account folder', async () => {
    const store = fakeStorage({
      [VAULT_ATTACHMENTS_BUCKET]: ['user-1/conn-1/aaa', 'user-1/conn-2/bbb', 'user-2/conn-9/ddd'],
    });

    await removeAttachmentFolder(store.client, 'user-1');

    expect(store.left(VAULT_ATTACHMENTS_BUCKET)).toEqual(['user-2/conn-9/ddd']);
  });

  it('pages past a thousand and removes a thousand at a time', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => `user-1/conn-1/${String(i).padStart(5, '0')}`);
    const store = fakeStorage({ [VAULT_ATTACHMENTS_BUCKET]: many });

    const removed = await removeAttachmentFolder(store.client, 'user-1/conn-1');

    expect(removed).toHaveLength(2500);
    expect(store.left(VAULT_ATTACHMENTS_BUCKET)).toEqual([]);
    expect(store.removeCalls.map((call) => call.paths.length)).toEqual([1000, 1000, 500]);
  });

  it('does nothing to an empty folder', async () => {
    const store = fakeStorage({ [VAULT_ATTACHMENTS_BUCKET]: [] });
    expect(await removeAttachmentFolder(store.client, 'user-1')).toEqual([]);
    expect(store.removeCalls).toEqual([]);
  });
});
