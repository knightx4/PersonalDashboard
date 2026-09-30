/**
 * An in-memory stand-in for Supabase Storage, enough for list and remove.
 *
 * It lists the way Storage does: one level at a time, a sub-folder as an entry
 * with a null id, at most `limit` entries from `offset`. That is what makes it
 * worth using over a mock that returns a fixed answer: code that forgets to
 * recurse or to page leaves objects behind here, as it would for real.
 */
export function fakeStorage(buckets: Record<string, string[]>) {
  const objects = new Map(Object.entries(buckets).map(([name, paths]) => [name, new Set(paths)]));
  const removeCalls: Array<{ bucket: string; paths: string[] }> = [];

  const client = {
    storage: {
      from(bucket: string) {
        const held = objects.get(bucket) ?? new Set<string>();
        objects.set(bucket, held);
        return {
          async list(path: string, options: { limit?: number; offset?: number } = {}) {
            const { limit = 100, offset = 0 } = options;
            const prefix = `${path}/`;
            const names = new Map<string, boolean>();
            for (const object of held) {
              if (!object.startsWith(prefix)) continue;
              const rest = object.slice(prefix.length);
              const slash = rest.indexOf('/');
              if (slash === -1) names.set(rest, true);
              else names.set(rest.slice(0, slash), names.get(rest.slice(0, slash)) ?? false);
            }
            const entries = [...names.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null }))
              .slice(offset, offset + limit);
            return { data: entries, error: null };
          },
          async remove(paths: string[]) {
            if (paths.length > 1000) {
              return { error: { message: 'too many names in one call' } };
            }
            removeCalls.push({ bucket, paths });
            for (const path of paths) held.delete(path);
            return { error: null };
          },
        };
      },
    },
  };

  return {
    client,
    removeCalls,
    /** What is left in a bucket, sorted. */
    left: (bucket: string) => [...(objects.get(bucket) ?? [])].sort(),
  };
}
