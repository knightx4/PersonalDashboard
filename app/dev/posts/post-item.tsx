'use client';

import Link from 'next/link';
import { Check, Copy, Download, Plus } from 'lucide-react';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { FieldError, Input, Textarea } from '@/components/ui/field';
import { StateLabel } from '@/components/dev/state-label';
import { cn } from '@/lib/cn';
import { MAX_THREAD_POSTS, threadCopyText, X_POST_LIMIT, xLength } from '@/lib/dev/posts';
import type { PostCard } from '@/lib/dev/posts-page';
import {
  dropPost,
  editPostBody,
  markPostPosted,
  restorePost,
  type PostsActionState,
} from './actions';
import { LinkedText } from '@/components/ui/linked-text';

/**
 * One draft on the Posts tab (plan #1419): its angle, its post and any thread
 * under it, the screenshot when there is one, the steps it came from, and
 * what can be done with it.
 *
 * A post is text until it is clicked (laws 12 and 14). Clicking turns that
 * post into a box in the same place with the counter live under it; Save
 * writes the whole thread back, and a post emptied and saved leaves the
 * thread. "Add a post" opens an empty one at the end, up to five.
 *
 * The counter counts the way X does (xLength: a link is 23, an emoji 2) and
 * turns red only past 280, the one state that needs doing something about.
 *
 * Copy puts the whole thread on the clipboard with a blank line between
 * posts. In a thread each post has its own copy as well, since X takes a
 * thread one reply at a time.
 */

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(key);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(null), 1800);
      },
      () => setCopied(null),
    );
  };
  return { copied, copy };
}

/** "243/280", or "12 over" in red once it is past the limit. */
function Counter({ text, id }: { text: string; id?: string }) {
  const length = xLength(text);
  const over = length - X_POST_LIMIT;
  return (
    <span
      id={id}
      className={cn('tabular text-small', over > 0 ? 'font-semibold text-danger' : 'text-ink-muted')}
      aria-label={over > 0 ? `${over} characters over the ${X_POST_LIMIT} limit` : `${length} of ${X_POST_LIMIT} characters`}
    >
      {over > 0 ? `${over} over` : `${length}/${X_POST_LIMIT}`}
    </span>
  );
}

function PostEditor({
  initial,
  label,
  onSave,
  onCancel,
}: {
  initial: string;
  label: string;
  onSave: (text: string) => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [saving, startSaving] = useTransition();
  const counterId = `${label.replace(/\W+/g, '-')}-count`;

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        startSaving(async () => setError(await onSave(text)));
      }}
    >
      {/* ui-ok: PostEditor is only rendered once a post is clicked or "Add a post" is pressed */}
      <Textarea
        aria-label={label}
        aria-describedby={counterId}
        aria-invalid={error ? true : undefined}
        autoFocus
        value={text}
        rows={4}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
        className="[field-sizing:content] min-h-20"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" pending={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <span className="ml-auto">
          <Counter text={text} id={counterId} />
        </span>
      </div>
      <FieldError>{error}</FieldError>
    </form>
  );
}

function MarkPosted({ id, onCancel }: { id: string; onCancel: () => void }) {
  const [state, action, pending] = useActionState(markPostPosted, {} as PostsActionState);
  return (
    <form action={action} className="flex w-full flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input
        name="url"
        type="url"
        inputMode="url"
        required
        autoFocus
        aria-label="Link to the post on X"
        aria-invalid={state.error ? true : undefined}
        placeholder="Paste the link to the post on X"
        className="min-w-0 flex-1 basis-60"
      />
      <Button type="submit" size="sm" pending={pending}>
        {pending ? 'Saving…' : 'Mark posted'}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
      <div className="basis-full">
        <FieldError>{state.error}</FieldError>
      </div>
    </form>
  );
}

function SuggestedActions({ card }: { card: PostCard }) {
  const { copied, copy } = useCopy();
  const [marking, setMarking] = useState(false);
  const [dropped, drop, dropping] = useActionState(dropPost, {} as PostsActionState);
  const thread = card.post.body.length > 1;

  if (marking) return <MarkPosted id={card.post.id} onCancel={() => setMarking(false)} />;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => copy('all', threadCopyText(card.post.body))}
      >
        {copied === 'all' ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
        {copied === 'all' ? 'Copied' : thread ? 'Copy thread' : 'Copy'}
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => setMarking(true)}>
        Mark posted
      </Button>
      <form action={drop}>
        <input type="hidden" name="id" value={card.post.id} />
        <Button type="submit" size="sm" variant="ghost" pending={dropping}>
          {dropping ? 'Dropping…' : 'Drop'}
        </Button>
      </form>
      <FieldError>{dropped.error}</FieldError>
    </div>
  );
}

function RestoreButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(restorePost, {} as PostsActionState);
  return (
    <form action={action} className="flex items-center gap-2 pt-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="ghost" pending={pending}>
        {pending ? 'Bringing back…' : 'Bring back'}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

function StatusLine({ card }: { card: PostCard }) {
  const { post, day } = card;
  if (post.status === 'posted') {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <StateLabel glyph="check" word={`Posted ${day}`} tone="quiet" />
        {post.postedUrl && (
          <a
            href={post.postedUrl}
            target="_blank"
            rel="noreferrer"
            className="text-small font-medium text-accent hover:underline"
          >
            Open on X
          </a>
        )}
      </span>
    );
  }
  if (post.status === 'dropped') return <StateLabel glyph="slash" word={`Dropped ${day}`} tone="ghost" />;
  return <span className="tabular text-small text-ink-muted">Drafted {day}</span>;
}

export function PostItem({ card }: { card: PostCard }) {
  const { post } = card;
  const editable = post.status === 'suggested';
  const [editing, setEditing] = useState<number | null>(null);
  const { copied, copy } = useCopy();
  const thread = post.body.length > 1;

  const save = async (index: number, text: string): Promise<string | undefined> => {
    const next = [...post.body];
    next[index] = text;
    const form = new FormData();
    form.set('id', post.id);
    form.set('body', JSON.stringify(next));
    const result = await editPostBody({}, form);
    if (result.error) return result.error;
    setEditing(null);
    return undefined;
  };

  return (
    <li id={`post-${post.id}`} className="flex scroll-mt-20 flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="min-w-0 flex-1 text-ui font-semibold text-ink">{post.angle}</h3>
        <StatusLine card={card} />
      </div>

      <ol className="flex flex-col gap-2" aria-label={thread ? 'The thread' : 'The post'}>
        {post.body.map((text, index) => {
          const label = thread ? `Post ${index + 1} of ${post.body.length}` : 'The post';
          return (
            <li key={index} className={cn(thread && 'border-l-2 border-border pl-3')}>
              {editing === index ? (
                <PostEditor
                  initial={text}
                  label={label}
                  onSave={(value) => save(index, value)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-col gap-0.5">
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => setEditing(index)}
                      aria-label={`Edit ${label.toLowerCase()}`}
                      // ui-ok: a draft being edited is the button that opens its editor; the posted text below links.
                      className="-mx-1 whitespace-pre-wrap rounded-control px-1 py-0.5 text-left text-body text-ink hover:bg-sunken focus-visible:outline-2"
                    >
                      {text}
                    </button>
                  ) : (
                    <p className="whitespace-pre-wrap text-body text-ink">
                      <LinkedText text={text} />
                    </p>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    {thread && editable && (
                      <button
                        type="button"
                        onClick={() => copy(String(index), text)}
                        className="press inline-flex items-center gap-1 rounded-control px-1 text-small text-ink-muted hover:text-ink focus-visible:outline-2"
                        aria-label={`Copy post ${index + 1}`}
                      >
                        {copied === String(index) ? (
                          <Check className="size-3.5" aria-hidden />
                        ) : (
                          <Copy className="size-3.5" aria-hidden />
                        )}
                        {copied === String(index) ? 'Copied' : 'Copy'}
                      </button>
                    )}
                    <Counter text={text} />
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {editing === post.body.length && (
          <li className="border-l-2 border-border pl-3">
            <PostEditor
              initial=""
              label={`Post ${post.body.length + 1}`}
              onSave={(value) => save(post.body.length, value)}
              onCancel={() => setEditing(null)}
            />
          </li>
        )}
      </ol>

      {editable && editing === null && post.body.length < MAX_THREAD_POSTS && (
        <div>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(post.body.length)}>
            <Plus className="size-3.5" aria-hidden />
            Add a post to the thread
          </Button>
        </div>
      )}

      {card.images.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {card.images.map((src) => (
            <div key={src} className="flex max-w-full flex-col items-start gap-1">
              <a href={src} target="_blank" rel="noreferrer" className="block max-w-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- a screenshot the person saves to post; the image optimiser would hand them a resized copy */}
                <img
                  src={src}
                  alt="Screenshot to post with this draft"
                  loading="lazy"
                  className="max-h-64 max-w-full rounded-sm bg-sunken object-contain"
                />
              </a>
              {/* The file itself, at full size, to attach on X. */}
              <a href={src} download className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                <Download className="size-3.5" aria-hidden />
                Save image
              </a>
            </div>
          ))}
        </div>
      )}

      {card.sources.length > 0 && (
        <p className="text-small text-ink-muted">
          From{' '}
          {card.sources.map((source, index) => (
            <span key={source.id}>
              {index > 0 && ', '}
              <Link
                href={source.href}
                title={source.title}
                className="tabular font-medium text-ink hover:underline"
              >
                {source.label}
              </Link>
            </span>
          ))}
        </p>
      )}

      {editable && editing === null && <SuggestedActions card={card} />}
      {post.status === 'dropped' && <RestoreButton id={post.id} />}
    </li>
  );
}
