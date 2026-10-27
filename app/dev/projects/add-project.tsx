'use client';

import { useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Plus } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/field';
import { Note } from '@/components/ui/note';
import { Popover } from '@/components/ui/popover';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { usePopover } from '@/lib/use-popover';
import {
  isAppRepository,
  NARROW_TOKEN_FIX,
  parseRepositoryName,
  tokenTooNarrow,
  type GithubRepository,
  type RepositoryListing,
} from '@/lib/plan/project-add';
import { addProject, listRepositories } from './actions';

/**
 * Add project, and the picker it opens (plan #2553.5).
 *
 * Two presses: the button, then a repository. The picker asks GitHub for the
 * repositories GITHUB_READ_TOKEN can see the first time it opens, lists them
 * newest pushed first with the ones already added marked, and narrows them as
 * you type. A token that sees only this app's repository gets a note saying
 * which setting widens it, and the typed owner/name under the list is how a
 * repository is added until then.
 *
 * The gallery draws it open with `listing` filled and, for its hidden parts,
 * a query typed (`query`) or an error showing (`error`).
 */
export function AddProject({
  added,
  label = 'Add project',
  variant = 'primary',
  defaultOpen = false,
  listing: givenListing,
  query: givenQuery = '',
  error: givenError = null,
}: {
  /** "owner/name" of every project already added and not archived, lower case. */
  added: readonly string[];
  label?: string;
  variant?: 'primary' | 'secondary';
  defaultOpen?: boolean;
  listing?: RepositoryListing;
  query?: string;
  error?: string | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [listing, setListing] = useState<RepositoryListing | null>(givenListing ?? null);
  const [query, setQuery] = useState(givenQuery);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(givenError);
  const [adding, setAdding] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [pending, startAdding] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchId = useId();
  const typedId = useId();
  usePopover({ open, onClose: () => setOpen(false), panelRef, triggerRef });

  const taken = new Set(added.map((name) => name.toLowerCase()));

  function toggle() {
    const next = !open;
    setOpen(next);
    setError(null);
    if (next && !listing) {
      startLoading(async () => {
        setListing(await listRepositories());
      });
    }
  }

  function add(repository: { owner: string; repo: string }) {
    const key = `${repository.owner}/${repository.repo}`;
    setError(null);
    setAdding(key);
    startAdding(async () => {
      const result = await addProject(repository);
      setAdding(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setTyped('');
      setQuery('');
      toast({
        text: result.restored
          ? `${result.label} is back on the plan.`
          : `Added ${result.label}. It has its own section on the plan.`,
      });
      router.refresh();
    });
  }

  function addTyped(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseRepositoryName(typed);
    if (!parsed) {
      setError('Write the repository as owner/name, such as knightx4/recipes.');
      return;
    }
    add(parsed);
  }

  const typedRepo = parseRepositoryName(typed);
  const typedKey = typedRepo ? `${typedRepo.owner}/${typedRepo.repo}` : null;
  const repositories = listing?.repositories ?? [];
  const narrow = listing !== null && !listing.error && tokenTooNarrow(repositories);
  const wanted = query.trim().toLowerCase();
  // This app is the workspaces' sections already, so it is never offered.
  const others = repositories.filter((repo) => !isAppRepository(repo));
  const shown = wanted
    ? others.filter(
        (repo) =>
          repo.fullName.toLowerCase().includes(wanted) ||
          (repo.description ?? '').toLowerCase().includes(wanted),
      )
    : others;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
        className={buttonVariants({ variant, size: 'md' })}
      >
        <Plus className="size-4" strokeWidth={1.75} aria-hidden />
        {label}
      </button>
      {open && (
        <Popover
          ref={panelRef}
          role="dialog"
          aria-label="Add a repository as a project"
          anchor="trigger-below-end"
          padding="panel"
          className="w-[min(24rem,calc(100vw-2rem))] space-y-3"
        >
          {listing === null || loading ? (
            <p className="text-small text-ink-muted" aria-live="polite">
              Asking GitHub for your repositories…
            </p>
          ) : listing.error ? (
            <Note tone="caution">{listing.error}</Note>
          ) : narrow ? (
            <Note tone="caution">{NARROW_TOKEN_FIX}</Note>
          ) : (
            <>
              <div>
                <Label htmlFor={searchId}>Your repositories</Label>
                <Input
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name"
                  autoComplete="off"
                />
              </div>
              {shown.length === 0 ? (
                <p className="py-2 text-small text-ink-muted">
                  No repository matches &ldquo;{query.trim()}&rdquo;. Type it below if GitHub has it under
                  another name.
                </p>
              ) : (
                <ul className="-mx-2 max-h-72 overflow-y-auto" aria-label="Repositories">
                  {shown.map((repo) => (
                    <RepositoryRow
                      key={repo.fullName}
                      repo={repo}
                      added={taken.has(repo.fullName.toLowerCase())}
                      adding={adding === repo.fullName}
                      disabled={pending}
                      onAdd={() => add({ owner: repo.owner, repo: repo.name })}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
          <form onSubmit={addTyped} className="space-y-1.5">
            <Label htmlFor={typedId}>{narrow || listing?.error ? 'Repository' : 'Or type one'}</Label>
            <div className="flex gap-2">
              <Input
                id={typedId}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="owner/name"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1"
              />
              <Button type="submit" variant="secondary" pending={pending && adding === typedKey}>
                Add
              </Button>
            </div>
          </form>
          <FieldError>{error}</FieldError>
        </Popover>
      )}
    </div>
  );
}

function RepositoryRow({
  repo,
  added,
  adding,
  disabled,
  onAdd,
}: {
  repo: GithubRepository;
  added: boolean;
  adding: boolean;
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onAdd}
        disabled={added || disabled}
        aria-busy={adding || undefined}
        className={cn(
          'press flex min-h-11 w-full items-center gap-3 rounded-control px-2 py-1.5 text-left',
          added ? 'cursor-default' : 'hover:bg-sunken disabled:opacity-60',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('truncate text-ui', added ? 'text-ink-muted' : 'text-ink')}>{repo.fullName}</span>
            {repo.private && (
              <Lock className="size-3 shrink-0 text-ink-muted" strokeWidth={1.75} aria-label="Private" role="img" />
            )}
          </span>
          {repo.description && <span className="block truncate text-small text-ink-muted">{repo.description}</span>}
        </span>
        {added ? (
          <span className="shrink-0 text-small text-ink-muted">Added</span>
        ) : (
          <span className="shrink-0 text-small font-medium text-accent">{adding ? 'Adding…' : 'Add'}</span>
        )}
      </button>
    </li>
  );
}
