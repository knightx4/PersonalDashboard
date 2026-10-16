'use client';

import Link, { linkVariants } from '@/components/ui/link';
import { Check, CircleAlert, Copy, Download, Plus } from 'lucide-react';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { CostHint } from '@/components/ui/cost-hint';
import { Tooltip } from '@/components/ui/tooltip';
import { formatXPrice, X_POST_PRICE_USD, X_POST_WITH_URL_PRICE_USD } from '@/lib/x/price';
import { FieldError, Input, Textarea } from '@/components/ui/field';
import { StateLabel } from '@/components/dev/state-label';
import { cn } from '@/lib/cn';
import {
  isUploadedPostImage,
  MAX_ANGLE,
  MAX_POST_IMAGES,
  MAX_THREAD_POSTS,
  threadCopyText,
  X_POST_LIMIT,
  xLength,
} from '@/lib/dev/posts';
import type { PostCard } from '@/lib/dev/posts-page';
import {
  addPostImage,
  confirmXMatch,
  dismissXMatch,
  dropPost,
  editPostAngle,
  editPostBody,
  markPostPosted,
  postToX,
  removePostImage,
  restorePost,
  type PostsActionState,
} from './actions';
import { LinkedText } from '@/components/ui/linked-text';
import { AddImage } from './add-image';
import { Thread } from '@/components/thread/thread';
import { threadRef } from '@/lib/thread/subjects';

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
 *
 * Last comes the comment thread (plan #2202.2), on a waiting or posted draft:
 * an Add a comment control until one is written. "@dash make this shorter"
 * gets a reply, and on a waiting draft Dash rewrites the text with
 * rewrite_post; a comment without the tag is only kept.
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
export function Counter({ text, id }: { text: string; id?: string }) {
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

/**
 * The angle, the one line saying what a draft is about. Text until clicked,
 * like the posts under it; Enter or Save writes it, Escape puts it back.
 */
function Angle({ id, angle, editable }: { id: string; angle: string; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(
    async (prev: PostsActionState, formData: FormData) => {
      const next = await editPostAngle(prev, formData);
      if (!next.error) setEditing(false);
      return next;
    },
    {} as PostsActionState,
  );

  if (!editable) return <h3 className="min-w-0 flex-1 text-ui font-semibold text-ink">{angle}</h3>;
  if (!editing) {
    return (
      <h3 className="min-w-0 flex-1 text-ui font-semibold text-ink">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit what this draft is about"
          // ui-ok: the angle of a waiting draft is the button that opens its editor, as the posts are.
          className="-mx-1 rounded-control px-1 text-left hover:bg-sunken focus-visible:outline-2"
        >
          {angle}
        </button>
      </h3>
    );
  }
  return (
    <form action={action} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input
        name="angle"
        required
        autoFocus
        defaultValue={angle}
        maxLength={MAX_ANGLE}
        aria-label="What this draft is about"
        aria-invalid={state.error ? true : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setEditing(false);
        }}
        className="min-w-0 flex-1 basis-60"
      />
      <Button type="submit" size="sm" pending={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
        Cancel
      </Button>
      <div className="basis-full">
        <FieldError>{state.error}</FieldError>
      </div>
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
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} pending={pending}>
        Cancel
      </Button>
      <div className="basis-full">
        <FieldError>{state.error}</FieldError>
      </div>
    </form>
  );
}

/** What the $ beside Post says: the exact price, since X's rates are fixed. */
function xPriceLine(send: NonNullable<PostCard['send']>): string {
  const posts = send.requests === 1 ? 'one post' : `${send.requests} posts`;
  const link =
    send.linkPosts.length > 0
      ? ` A post with a link costs ${formatXPrice(X_POST_WITH_URL_PRICE_USD)} instead of ${formatXPrice(X_POST_PRICE_USD)}.`
      : '';
  return `X charges ${formatXPrice(send.priceUsd)} for ${posts}.${link}`;
}

function postNumbers(numbers: number[], total: number): string {
  if (total === 1) return 'This post has';
  const named = numbers.map(String);
  const list = named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0];
  return `${named.length > 1 ? 'Posts' : 'Post'} ${list} ${named.length > 1 ? 'have' : 'has'}`;
}

/**
 * Post pressed once (plan #2072): what will go where and what X charges,
 * with the link warning when a post holds a link, then Cancel and Yes, post
 * it. It takes the row the other actions sat in, so the one decision is the
 * only thing there. While it sends, both buttons are disabled, and the action
 * claims the draft as well, so a double press posts once.
 */
function ConfirmPost({
  card,
  send,
  handle,
  onCancel,
}: {
  card: PostCard;
  send: NonNullable<PostCard['send']>;
  handle: string;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const total = card.post.body.length;
  const partial = total - send.requests;
  const what =
    partial > 0
      ? `Sends posts ${partial + 1} to ${total} of the thread to @${handle} on X now`
      : total > 1
        ? `Posts this thread of ${total} to @${handle} on X now`
        : `Posts this to @${handle} on X now`;

  return (
    <div role="group" aria-label="Post to X" className="flex flex-col items-start gap-2 pt-1">
      <p className="max-w-prose text-small text-ink-muted">
        {what}. X charges {formatXPrice(send.priceUsd)}.
      </p>
      {send.warnings.length > 0 && (
        <p className="max-w-prose text-small text-caution">Worth a look first: {send.warnings.join('; ')}.</p>
      )}
      {send.linkPosts.length > 0 && (
        <p className="max-w-prose text-small text-caution">
          {postNumbers(send.linkPosts, total)} a link, which X charges {formatXPrice(X_POST_WITH_URL_PRICE_USD)} a
          post for instead of {formatXPrice(X_POST_PRICE_USD)}, about 13 times more.
        </p>
      )}
      {card.images.length > 0 && partial === 0 && (
        <p className="max-w-prose text-small text-ink-muted">
          {card.images.length === 1 ? 'The image goes' : 'The images go'} on the {total > 1 ? 'first post' : 'post'}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          autoFocus
          pending={pending}
          onClick={() =>
            start(async () => {
              const form = new FormData();
              form.set('id', card.post.id);
              const result = await postToX(form);
              if (!result.ok) setError(result.error ?? 'That did not work.');
            })
          }
        >
          {pending ? 'Posting…' : 'Yes, post it'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </div>
  );
}

/**
 * Post (plan #2072): the button that sends this draft to X as the connected
 * account, with the $ beside it saying what X charges. The first press opens
 * ConfirmPost in place of the row; only Yes, post it sends. What the check
 * finds (a mention, a post past 280) never takes the button away: it shows as
 * a ! beside it, and again on the confirm step, and the person decides.
 */
function SuggestedActions({
  card,
  postAs,
  postArmed = false,
}: {
  card: PostCard;
  postAs: string | null;
  postArmed?: boolean;
}) {
  const { copied, copy } = useCopy();
  const [marking, setMarking] = useState(false);
  const [posting, setPosting] = useState(postArmed);
  const [dropped, drop, dropping] = useActionState(dropPost, {} as PostsActionState);
  const thread = card.post.body.length > 1;
  const send = postAs && card.send?.ok ? card.send : null;

  if (marking) return <MarkPosted id={card.post.id} onCancel={() => setMarking(false)} />;
  if (posting && postAs && send) {
    return <ConfirmPost card={card} send={send} handle={postAs} onCancel={() => setPosting(false)} />;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {send && (
        <span className="inline-flex items-center">
          <Button type="button" size="sm" onClick={() => setPosting(true)}>
            {send.requests < card.post.body.length ? 'Post the rest' : 'Post'}
          </Button>
          {/* dash-action-ok: X's price for a post the person makes; Dash never posts and no model runs. */}
          <CostHint text={xPriceLine(send)} what="Cost of posting to X" />
          {send.warnings.length > 0 && (
            <Tooltip label={`Worth a look: ${send.warnings.join('; ')}.`}>
              <span
                tabIndex={0}
                aria-label="Something to check before posting"
                className="flex size-8 items-center justify-center rounded-control text-caution"
              >
                <CircleAlert className="size-3.5" strokeWidth={1.75} aria-hidden />
              </span>
            </Tooltip>
          )}
        </span>
      )}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => copy('all', threadCopyText(card.post.body))}
      >
        {/* Beside Post the row runs out of room at 390, so Copy drops its icon there. */}
        {send ? null : copied === 'all' ? (
          <Check strokeWidth={1.75} className="size-3.5" aria-hidden />
        ) : (
          <Copy strokeWidth={1.75} className="size-3.5" aria-hidden />
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

/**
 * "Is this it?" (plan #1820): a post on X that reads close to this draft but
 * not close enough to mark it posted unasked. Yes, this is it marks the draft posted with
 * that post's link; No stops asking, and the post is listed under Posted on X.
 */
function IsThisIt({ postId, candidate }: { postId: string; candidate: NonNullable<PostCard['candidate']> }) {
  const [confirmed, confirm, confirming] = useActionState(confirmXMatch, {} as PostsActionState);
  const [dismissed, dismiss, dismissing] = useActionState(dismissXMatch, {} as PostsActionState);
  const busy = confirming || dismissing;
  return (
    <section aria-label="Is this it?" className="flex flex-col gap-2 rounded-control bg-sunken px-3 py-2.5">
      <p className="text-small text-ink">
        <span className="font-semibold">Is this it?</span>{' '}
        <span className="text-ink-muted">
          Posted on X on {candidate.day}
          {candidate.threadPosts > 1 ? `, the first of a thread of ${candidate.threadPosts}` : ''}.
        </span>
      </p>
      <p className="line-clamp-6 whitespace-pre-wrap break-words text-body text-ink">
        <LinkedText text={candidate.text} />
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <form action={confirm}>
          <input type="hidden" name="id" value={postId} />
          <input type="hidden" name="x_post_id" value={candidate.xPostId} />
          <Button type="submit" size="sm" variant="secondary" pending={confirming} disabled={busy}>
            {confirming ? 'Saving…' : 'Yes, this is it'}
          </Button>
        </form>
        <form action={dismiss}>
          <input type="hidden" name="id" value={postId} />
          <input type="hidden" name="x_post_id" value={candidate.xPostId} />
          <Button type="submit" size="sm" variant="ghost" pending={dismissing} disabled={busy}>
            {dismissing ? 'Saving…' : 'No, not this one'}
          </Button>
        </form>
        <a
          href={candidate.url}
          target="_blank"
          rel="noreferrer"
          className={cn('press-area text-small font-medium', linkVariants())}
        >
          Open on X
        </a>
      </div>
      <FieldError>{confirmed.error ?? dismissed.error}</FieldError>
    </section>
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
        <StateLabel
          glyph="check"
          word={`Posted ${day}`}
          tone="quiet"
          title="You posted this on X. Nothing more is needed."
        />
        {post.postedUrl && (
          <a
            href={post.postedUrl}
            target="_blank"
            rel="noreferrer"
            className={cn('press-area text-small font-medium', linkVariants())}
          >
            Open on X
          </a>
        )}
      </span>
    );
  }
  if (post.status === 'dropped')
    return (
      <StateLabel
        glyph="slash"
        word={`Dropped ${day}`}
        tone="ghost"
        title="You dropped this draft. Bring it back if you want to post it after all."
      />
    );
  return <span className="tabular text-small text-ink-muted">Drafted {day}</span>;
}

/**
 * One image on a draft: the picture, Save image for attaching it on X, and on
 * a waiting draft a Remove. An upload is saved through the signing route with
 * `download`, since a link to another host ignores the download attribute.
 */
function PostImage({
  postId,
  image,
  editable,
}: {
  postId: string;
  image: PostCard['images'][number];
  editable: boolean;
}) {
  const [state, remove, removing] = useActionState(removePostImage, {} as PostsActionState);
  const uploaded = isUploadedPostImage(image.path);
  return (
    <div className="flex max-w-full flex-col items-start gap-1">
      <a href={image.src} target="_blank" rel="noreferrer" className="block max-w-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- an image the person saves to post; the image optimiser would hand them a resized copy */}
        <img
          src={image.src}
          alt="Image to post with this draft"
          loading="lazy"
          className="max-h-64 max-w-full rounded-card bg-sunken object-contain"
        />
      </a>
      <div className="flex flex-wrap items-center gap-1">
        {/* The file itself, at full size, to attach on X. */}
        <a
          href={uploaded ? `${image.src}&download` : image.src}
          download
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          <Download strokeWidth={1.75} className="size-3.5" aria-hidden />
          Save image
        </a>
        {editable && (
          <form action={remove}>
            <input type="hidden" name="id" value={postId} />
            <input type="hidden" name="path" value={image.path} />
            <Button type="submit" size="sm" variant="ghost" pending={removing}>
              {removing ? 'Removing…' : 'Remove'}
            </Button>
          </form>
        )}
      </div>
      <FieldError>{state.error}</FieldError>
    </div>
  );
}

export function PostItem({
  card,
  postAs = null,
  postArmed,
  commentOpen,
}: {
  card: PostCard;
  /** The handle a draft is posted as from the tab; null when the sign-in cannot post. */
  postAs?: string | null;
  /** Draw Post already pressed once, its confirm showing: the gallery's hidden part. */
  postArmed?: boolean;
  /** Draw the comment box open: the gallery's hidden part. */
  commentOpen?: boolean;
}) {
  const { post } = card;
  const editable = post.status === 'suggested' || post.status === 'planned';
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
    <li id={`post-${post.id}`} className="flex scroll-mt-bar flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Angle id={post.id} angle={post.angle} editable={editable} />
        <StatusLine card={card} />
      </div>

      <ol className="flex flex-col gap-2" aria-label={thread ? 'The thread' : 'The post'}>
        {post.body.map((text, index) => {
          const label = thread ? `Post ${index + 1} of ${post.body.length}` : 'The post';
          // A post already on X from a send that stopped part-way (plan
          // #2072): marked, linked, and no longer edited, since X has it.
          const onX = post.xThreadIds?.[index] ?? null;
          if (onX) {
            return (
              <li key={index} className={cn(thread && 'border-l-2 border-border pl-3')}>
                <div className="flex flex-col gap-0.5">
                  <p className="whitespace-pre-wrap text-body text-ink">
                    <LinkedText text={text} />
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <StateLabel glyph="check" word="On X" tone="quiet" title="This post went up on X." />
                    <a
                      href={`https://x.com/i/status/${onX}`}
                      target="_blank"
                      rel="noreferrer"
                      className={cn('press-area text-small font-medium', linkVariants())}
                    >
                      Open on X
                    </a>
                  </div>
                </div>
              </li>
            );
          }
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => copy(String(index), text)}
                        className="gap-1"
                        aria-label={`Copy post ${index + 1}`}
                      >
                        {copied === String(index) ? (
                          <Check strokeWidth={1.75} className="size-3.5" aria-hidden />
                        ) : (
                          <Copy strokeWidth={1.75} className="size-3.5" aria-hidden />
                        )}
                        {copied === String(index) ? 'Copied' : 'Copy'}
                      </Button>
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
            <Plus strokeWidth={1.75} className="size-3.5" aria-hidden />
            Add a post to the thread
          </Button>
        </div>
      )}

      {(card.images.length > 0 || editable) && (
        <div className="flex flex-col gap-2">
          {card.images.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {card.images.map((image) => (
                <PostImage key={image.path} postId={post.id} image={image} editable={editable} />
              ))}
            </div>
          )}
          {editable && card.images.length < MAX_POST_IMAGES && (
            <AddImage
              room={MAX_POST_IMAGES - card.images.length}
              onUploaded={async (path) => {
                const form = new FormData();
                form.set('id', post.id);
                form.set('path', path);
                const result = await addPostImage({}, form);
                return result.error;
              }}
            />
          )}
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
                className={cn('tabular font-medium', linkVariants())}
              >
                {source.label}
              </Link>
            </span>
          ))}
        </p>
      )}

      {card.candidate && editing === null && <IsThisIt postId={post.id} candidate={card.candidate} />}

      {editable && editing === null && <SuggestedActions card={card} postAs={postAs} postArmed={postArmed} />}
      {post.status === 'dropped' && <RestoreButton id={post.id} />}

      {post.status !== 'dropped' && (
        <Thread
          subject={threadRef('post', post.id)}
          turns={card.thread}
          composerOpen={commentOpen}
          placeholder={
            editable ? 'A note on this draft, or @dash to ask for a change.' : 'A note on this post, or a question for Dash.'
          }
        />
      )}
    </li>
  );
}
